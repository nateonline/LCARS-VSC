/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableResizeObserver, scheduleAtNextAnimationFrame } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { Disposable, DisposableStore, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IWorkbenchContribution } from '../../../common/contributions.js';
import { IWorkbenchLayoutService, isLcarsFrameEnabled, LayoutSettings, Parts, Position } from '../../../services/layout/browser/layoutService.js';

const FRAME_CLASS = 'lcars-frame';
const MIRRORED_CLASS = 'lcars-frame-mirrored';
const RAIL_CLASS = 'lcars-frame-rail';
const COLUMN_CLASS = 'lcars-frame-column';
const TOP_ELBOW_CLASS = 'lcars-frame-top-elbow';
const GEOMETRY_PROPERTIES = ['--lcars-rail-offset', '--lcars-rail-width', '--lcars-column-offset', '--lcars-column-width', '--lcars-bar-start'];

const EDITOR_TAB_HEIGHT_SETTING = 'window.density.editorTabHeight';
const SIDE_BAR_LOCATION_SETTING = 'workbench.sideBar.location';

/** Edges closer than this (in CSS pixels) are treated as touching. */
const EDGE_TOLERANCE = 1;

/**
 * Lays out the LCARS frame around the editor. The activity bar (rail) and the primary side
 * bar (column) run down into the status bar, where they end in caps; the column curves into
 * the status bar and, through the side bar title, into the editor tabs. Parts reserve the
 * space for these shapes (see `isLcarsFrameEnabled`); this contribution measures where the
 * parts are and exposes that geometry to `lcars.css` as classes and custom properties on
 * the main container.
 */
export class LcarsFrame extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.lcarsFrame';

	private readonly scheduledUpdate = this._register(new MutableDisposable());
	private readonly resizeObserver = this._register(new DisposableResizeObserver('lcarsFrame', () => this.update(), mainWindow));
	private readonly observedParts = this._register(new DisposableStore());
	private readonly observedElements = new Set<HTMLElement>();

	constructor(
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (
				e.affectsConfiguration(LayoutSettings.LCARS_FRAME) ||
				e.affectsConfiguration(LayoutSettings.MODERN_UI) ||
				e.affectsConfiguration(EDITOR_TAB_HEIGHT_SETTING) ||
				e.affectsConfiguration(SIDE_BAR_LOCATION_SETTING)
			) {
				this.scheduleUpdate();
			}
		}));
		this._register(this.layoutService.onDidChangePartVisibility(() => this.scheduleUpdate()));
		this._register(this.layoutService.onDidLayoutMainContainer(() => this.scheduleUpdate()));
		this._register(this.layoutService.onDidChangePanelPosition(() => this.scheduleUpdate()));
		this._register(this.layoutService.onDidChangePanelAlignment(() => this.scheduleUpdate()));
		this._register(toDisposable(() => this.reset()));

		this.update();
	}

	private scheduleUpdate(): void {
		this.scheduledUpdate.value = scheduleAtNextAnimationFrame(mainWindow, () => this.update());
	}

	private update(): void {
		this.scheduledUpdate.clear();

		const container = this.layoutService.mainContainer;
		if (!isLcarsFrameEnabled(this.layoutService, this.configurationService)) {
			this.reset();
			return;
		}

		container.classList.add(FRAME_CLASS);
		this.observeParts();

		const mirrored = this.layoutService.getSideBarPosition() === Position.RIGHT;
		container.classList.toggle(MIRRORED_CLASS, mirrored);

		const statusbarRect = this.getRect(Parts.STATUSBAR_PART);
		const activitybarRect = this.getRect(Parts.ACTIVITYBAR_PART);
		const sidebarRect = this.getRect(Parts.SIDEBAR_PART);
		const editorRect = this.getRect(Parts.EDITOR_PART);

		// Only the rail and column that reach the status bar continue into it
		// (a justified panel, for example, runs underneath the side bar instead).
		const reachesStatusbar = (rect: DOMRect | undefined): rect is DOMRect => !!rect && !!statusbarRect && Math.abs(rect.bottom - statusbarRect.top) < EDGE_TOLERANCE;
		const rail = reachesStatusbar(activitybarRect) ? activitybarRect : undefined;
		const column = reachesStatusbar(sidebarRect) ? sidebarRect : undefined;

		// Offsets are measured along the status bar from the window edge the columns are on.
		const offset = (rect: DOMRect) => !statusbarRect ? 0 : mirrored ? statusbarRect.right - rect.right : rect.left - statusbarRect.left;
		const barStart = column ? offset(column) + column.width : rail ? offset(rail) + rail.width : 0;

		const style = container.style;
		style.setProperty('--lcars-rail-offset', `${rail ? offset(rail) : 0}px`);
		style.setProperty('--lcars-rail-width', `${rail?.width ?? 0}px`);
		style.setProperty('--lcars-column-offset', `${column ? offset(column) : 0}px`);
		style.setProperty('--lcars-column-width', `${column?.width ?? 0}px`);
		style.setProperty('--lcars-bar-start', `${barStart}px`);
		container.classList.toggle(RAIL_CLASS, !!rail);
		container.classList.toggle(COLUMN_CLASS, !!column);

		// The side bar title curves into the editor tabs when both share the top edge and the
		// tabs are as thin as the frame's horizontal bars.
		const compactTabs = this.configurationService.getValue<string>(EDITOR_TAB_HEIGHT_SETTING) === 'compact';
		const topElbow = compactTabs && !!sidebarRect && !!editorRect &&
			Math.abs(sidebarRect.top - editorRect.top) < EDGE_TOLERANCE &&
			Math.abs(mirrored ? sidebarRect.left - editorRect.right : sidebarRect.right - editorRect.left) < EDGE_TOLERANCE;
		container.classList.toggle(TOP_ELBOW_CLASS, topElbow);
	}

	private getRect(part: Parts.ACTIVITYBAR_PART | Parts.SIDEBAR_PART | Parts.EDITOR_PART | Parts.STATUSBAR_PART): DOMRect | undefined {
		const visible = part === Parts.EDITOR_PART || part === Parts.STATUSBAR_PART
			? this.layoutService.isVisible(part, mainWindow)
			: this.layoutService.isVisible(part);
		if (!visible) {
			return undefined;
		}

		const rect = this.layoutService.getContainer(mainWindow, part)?.getBoundingClientRect();
		return rect && rect.width > 0 && rect.height > 0 ? rect : undefined;
	}

	private observeParts(): void {
		for (const part of [Parts.ACTIVITYBAR_PART, Parts.SIDEBAR_PART, Parts.EDITOR_PART, Parts.STATUSBAR_PART]) {
			const element = this.layoutService.getContainer(mainWindow, part);
			if (element && !this.observedElements.has(element)) {
				this.observedElements.add(element);
				this.observedParts.add(this.resizeObserver.observe(element));
			}
		}
	}

	private reset(): void {
		const container = this.layoutService.mainContainer;
		container.classList.remove(FRAME_CLASS, MIRRORED_CLASS, RAIL_CLASS, COLUMN_CLASS, TOP_ELBOW_CLASS);
		for (const property of GEOMETRY_PROPERTIES) {
			container.style.removeProperty(property);
		}
	}
}

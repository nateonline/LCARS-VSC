/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/lcarsViews.css';
import { $, append } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { timeout } from '../../../../base/common/async.js';
import { KeyCode, KeyMod } from '../../../../base/common/keyCodes.js';
import { Disposable, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { KeybindingWeight } from '../../../../platform/keybinding/common/keybindingsRegistry.js';
import { getWorkbenchContribution, IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { IWorkbenchLayoutService, Parts } from '../../../services/layout/browser/layoutService.js';
import { IStatusbarEntryAccessor, IStatusbarService, StatusbarAlignment } from '../../../services/statusbar/browser/statusbar.js';

/**
 * The full-window views of the LCARS interface. Only one of them is shown at a time:
 * the editor, the side bar (explorer, source control, search...), the panel (problems,
 * terminal, output...) or the auxiliary bar (chat).
 */
export type LcarsView = 'editor' | 'sidebar' | 'panel' | 'auxiliary';

export const LCARS_TOGGLE_VIEW_COMMAND_ID = 'workbench.action.lcars.toggleView';
export const LCARS_VIEWS_ENABLED_SETTING = 'lcars.views.enabled';

const VIEW_CLASSES: Record<LcarsView, string> = {
	editor: 'lcars-view-editor',
	sidebar: 'lcars-view-sidebar',
	panel: 'lcars-view-panel',
	auxiliary: 'lcars-view-auxiliary'
};

const VIEW_OUT_CLASS = 'lcars-view-out';
const VIEW_IN_CLASS = 'lcars-view-in';

/** Keep in sync with the durations of `lcars-view-swipe-out` and `lcars-view-swipe-in` in `lcarsViews.css`. */
const VIEW_OUT_MS = 260;
const VIEW_IN_MS = 520;

const HUB_ART_COLORS = ['orange', 'lavender', 'blue', 'magenta', 'tan', 'purple', 'peach', 'red'];

/**
 * Makes the workbench show one full-window view at a time and animates between them.
 *
 * The side bar, panel and auxiliary bar are maximized (hiding the editor) when they are opened and
 * the editor is brought back when a file is opened or the back button in the status bar is used.
 */
class LcarsViewManager extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.lcarsViews';

	private view: LcarsView = 'editor';
	private lastNonEditorView: Exclude<LcarsView, 'editor'> = 'sidebar';
	private busy = false;
	private pending: LcarsView | undefined;

	private readonly backEntry = this._register(new MutableDisposable<IStatusbarEntryAccessor>());

	constructor(
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IEditorService editorService: IEditorService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IStatusbarService private readonly statusbarService: IStatusbarService
	) {
		super();

		if (!this.enabled()) {
			return;
		}

		this.createHubArt();

		// Start on the side bar view like the home screen of the interface
		this.apply('sidebar');
		this.updateChrome();

		this._register(this.layoutService.onDidChangePartVisibility(({ partId, visible }) => {
			if (!visible || this.busy) {
				return;
			}

			switch (partId) {
				case Parts.SIDEBAR_PART:
					this.go('sidebar');
					break;
				case Parts.PANEL_PART:
					this.go('panel');
					break;
				case Parts.AUXILIARYBAR_PART:
					this.go('auxiliary');
					break;
			}
		}));

		this._register(this.layoutService.onDidChangeSideBarMaximized(() => {
			if (!this.busy && this.view === 'sidebar' && !this.layoutService.isSideBarMaximized()) {
				this.view = 'editor';
				this.updateChrome();
			}
		}));

		this._register(editorService.onWillOpenEditor(() => {
			if (this.view !== 'editor') {
				this.go('editor');
			}
		}));
	}

	private enabled(): boolean {
		return this.configurationService.getValue<boolean>(LCARS_VIEWS_ENABLED_SETTING) !== false;
	}

	private animated(): boolean {
		return this.layoutService.mainContainer.classList.contains('lcars-animated');
	}

	/** Switches to the other half of the editor/hub pair, used by the back button. */
	toggle(): void {
		this.go(this.view === 'editor' ? this.lastNonEditorView : 'editor');
	}

	/** Switches to the given view, swiping the old view off and the new view on. */
	async go(target: LcarsView): Promise<void> {
		if (this.busy) {
			this.pending = target;
			return;
		}
		if (target === this.view) {
			return;
		}

		this.busy = true;
		const container = this.layoutService.mainContainer;
		try {
			const animate = this.animated();
			if (animate) {
				container.classList.add(VIEW_OUT_CLASS);
				await timeout(VIEW_OUT_MS);
			}

			this.apply(target);
			this.updateChrome();

			if (animate) {
				container.classList.remove(VIEW_OUT_CLASS);
				container.classList.add(VIEW_IN_CLASS);
				await timeout(VIEW_IN_MS);
			}
		} finally {
			container.classList.remove(VIEW_OUT_CLASS, VIEW_IN_CLASS);
			this.busy = false;
		}

		const pending = this.pending;
		this.pending = undefined;
		if (pending && !this._store.isDisposed) {
			await this.go(pending);
		}
	}

	/** Rearranges the layout so that only the target view is visible. */
	private apply(target: LcarsView): void {
		const wasBusy = this.busy;
		this.busy = true;
		try {
			const layout = this.layoutService;

			if (target !== 'sidebar' && layout.isSideBarMaximized()) {
				layout.setSideBarMaximized(false);
			}
			if (target !== 'auxiliary' && layout.isAuxiliaryBarMaximized()) {
				layout.setAuxiliaryBarMaximized(false);
			}
			if (target !== 'panel' && layout.isPanelMaximized()) {
				layout.toggleMaximizedPanel();
			}

			const hideOthers: [Parts, LcarsView][] = [
				[Parts.SIDEBAR_PART, 'sidebar'],
				[Parts.PANEL_PART, 'panel'],
				[Parts.AUXILIARYBAR_PART, 'auxiliary']
			];
			for (const [part, view] of hideOthers) {
				if (view !== target && layout.isVisible(part, mainWindow)) {
					layout.setPartHidden(true, part);
				}
			}

			switch (target) {
				case 'sidebar':
					layout.setSideBarMaximized(true);
					break;
				case 'auxiliary':
					layout.setPartHidden(false, Parts.AUXILIARYBAR_PART);
					layout.setAuxiliaryBarMaximized(true);
					break;
				case 'panel':
					layout.setPartHidden(false, Parts.PANEL_PART);
					if (layout.isVisible(Parts.EDITOR_PART, mainWindow)) {
						layout.toggleMaximizedPanel();
					}
					break;
				case 'editor':
					if (!layout.isVisible(Parts.EDITOR_PART, mainWindow)) {
						layout.setPartHidden(false, Parts.EDITOR_PART);
					}
					break;
			}

			if (target !== 'editor') {
				this.lastNonEditorView = target;
			}
			this.view = target;
		} finally {
			this.busy = wasBusy;
		}
	}

	private updateChrome(): void {
		const classList = this.layoutService.mainContainer.classList;
		for (const [view, className] of Object.entries(VIEW_CLASSES)) {
			classList.toggle(className, view === this.view);
		}

		const text = this.view === 'editor'
			? `$(arrow-left) ${localize('lcarsBackToHub', "Back")}`
			: `${localize('lcarsToEditor', "Editor")} $(arrow-right)`;
		const ariaLabel = this.view === 'editor'
			? localize('lcarsBackToHubAria', "Back to the previous view")
			: localize('lcarsToEditorAria', "Go to the editor");
		const entry = {
			name: localize('lcarsBackName', "LCARS View Switcher"),
			text,
			ariaLabel,
			tooltip: ariaLabel,
			command: LCARS_TOGGLE_VIEW_COMMAND_ID
		};

		if (this.backEntry.value) {
			this.backEntry.value.update(entry);
		} else {
			this.backEntry.value = this.statusbarService.addEntry(entry, 'lcars.back', StatusbarAlignment.LEFT, 100000);
		}
	}

	/** Decorative pills in the empty area of the full-window side bar. */
	private createHubArt(): void {
		const sideBar = this.layoutService.getContainer(mainWindow, Parts.SIDEBAR_PART);
		if (!sideBar) {
			return;
		}

		const art = append(sideBar, $('.lcars-hub-art'));
		art.setAttribute('aria-hidden', 'true');
		this._register(toDisposable(() => art.remove()));

		for (let i = 0; i < 9; i++) {
			const pill = append(art, $(`.lcars-hub-art-pill.lcars-color-${HUB_ART_COLORS[i % HUB_ART_COLORS.length]}`));
			pill.style.setProperty('--lcars-art-delay', `${-Math.random() * 12}s`);
			pill.style.setProperty('--lcars-art-duration', `${7 + Math.random() * 9}s`);
			pill.style.setProperty('--lcars-art-width', `${35 + Math.random() * 65}%`);
		}
	}
}

registerWorkbenchContribution2(LcarsViewManager.ID, LcarsViewManager, WorkbenchPhase.AfterRestored);

registerAction2(class ToggleLcarsViewAction extends Action2 {

	constructor() {
		super({
			id: LCARS_TOGGLE_VIEW_COMMAND_ID,
			title: localize2('lcarsToggleView', "Toggle Editor and Hub View"),
			category: localize2('lcarsCategory', "LCARS"),
			f1: true,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.Alt | KeyCode.Home
			}
		});
	}

	run(): void {
		getWorkbenchContribution<LcarsViewManager>(LcarsViewManager.ID)?.toggle();
	}
});

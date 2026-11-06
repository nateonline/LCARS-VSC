/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/lcars.css';
import { $, append, getWindow } from '../../../../base/browser/dom.js';
import { Disposable, DisposableStore, MutableDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IWorkbenchLayoutService } from '../../../services/layout/browser/layoutService.js';
import { IStatusbarService, StatusbarAlignment } from '../../../services/statusbar/browser/statusbar.js';

const LCARS_CLASS = 'lcars';
const LCARS_ANIMATED_CLASS = 'lcars-animated';
const LCARS_BOOTING_CLASS = 'lcars-booting';

const ENABLE_ANIMATIONS_SETTING = 'lcars.animations.enabled';
const ENABLE_BOOT_SETTING = 'lcars.animations.bootSequence';

/** Total duration of the boot sequence in milliseconds, kept in sync with `lcars.css`. */
const BOOT_DURATION_MS = 4200;
const RIBBON_SEGMENT_COUNT = 9;
const RIBBON_COLORS = ['orange', 'peach', 'lavender', 'blue', 'magenta', 'tan', 'purple', 'red'];

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'lcars',
	order: 1,
	title: localize('lcarsConfigurationTitle', "LCARS"),
	type: 'object',
	properties: {
		[ENABLE_ANIMATIONS_SETTING]: {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.APPLICATION,
			description: localize('lcars.animations.enabled', "Controls whether the LCARS interface animates its panels and decorative ribbons."),
		},
		[ENABLE_BOOT_SETTING]: {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.APPLICATION,
			description: localize('lcars.animations.bootSequence', "Controls whether the panels power up one after another when the window opens."),
		}
	}
});

/**
 * Applies the LCARS visual language to the workbench: it toggles the root classes that
 * `lcars.css` styles, plays the boot sequence, animates the decorative ribbons and
 * publishes a stardate readout in the status bar.
 */
class LcarsContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.lcars';

	private readonly ribbonDisposables = this._register(new MutableDisposable<DisposableStore>());

	constructor(
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IStatusbarService statusbarService: IStatusbarService
	) {
		super();

		const container = this.layoutService.mainContainer;
		container.classList.add(LCARS_CLASS);
		this._register(toDisposable(() => container.classList.remove(LCARS_CLASS, LCARS_ANIMATED_CLASS, LCARS_BOOTING_CLASS)));

		this.updateAnimations();
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(ENABLE_ANIMATIONS_SETTING)) {
				this.updateAnimations();
			}
		}));

		this.registerStardate(statusbarService);
		this.playBootSequence(container);
	}

	private animationsEnabled(): boolean {
		const window = getWindow(this.layoutService.mainContainer);
		return this.configurationService.getValue<boolean>(ENABLE_ANIMATIONS_SETTING) !== false
			&& !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	}

	private updateAnimations(): void {
		const container = this.layoutService.mainContainer;
		const enabled = this.animationsEnabled();
		container.classList.toggle(LCARS_ANIMATED_CLASS, enabled);

		this.ribbonDisposables.clear();
		const store = new DisposableStore();
		this.ribbonDisposables.value = store;
		this.createRibbon(container, 'lcars-ribbon-top', store, enabled);
		this.createRibbon(container, 'lcars-ribbon-bottom', store, enabled);
	}

	/** Creates a strip of colored pills whose widths shift and which swipe on and off at random. */
	private createRibbon(container: HTMLElement, className: string, store: DisposableStore, animate: boolean): void {
		const window = getWindow(container);
		const ribbon = append(container, $(`.lcars-ribbon.${className}`));
		store.add(toDisposable(() => ribbon.remove()));

		const segments: HTMLElement[] = [];
		for (let i = 0; i < RIBBON_SEGMENT_COUNT; i++) {
			const segment = append(ribbon, $(`.lcars-ribbon-segment.lcars-color-${RIBBON_COLORS[i % RIBBON_COLORS.length]}`));
			segment.style.flexGrow = String(1 + Math.random() * 5);
			segments.push(segment);
		}

		if (!animate) {
			return;
		}

		const randomSegment = () => segments[Math.floor(Math.random() * segments.length)];

		const resize = () => {
			randomSegment().style.flexGrow = String(0.5 + Math.random() * 8);
		};
		const swipe = () => {
			const segment = randomSegment();
			segment.classList.remove('lcars-swiping');
			void segment.offsetWidth; // restart the animation
			segment.classList.add('lcars-swiping');
			segment.style.flexGrow = String(1 + Math.random() * 6);
		};
		const recolor = () => {
			const segment = randomSegment();
			const color = RIBBON_COLORS[Math.floor(Math.random() * RIBBON_COLORS.length)];
			segment.className = `lcars-ribbon-segment lcars-color-${color} lcars-swiping`;
		};

		const resizeHandle = window.setInterval(resize, 700);
		const swipeHandle = window.setInterval(swipe, 2300);
		const recolorHandle = window.setInterval(recolor, 3700);
		store.add(toDisposable(() => {
			window.clearInterval(resizeHandle);
			window.clearInterval(swipeHandle);
			window.clearInterval(recolorHandle);
		}));
	}

	private playBootSequence(container: HTMLElement): void {
		if (!this.animationsEnabled() || this.configurationService.getValue<boolean>(ENABLE_BOOT_SETTING) === false) {
			return;
		}

		const window = getWindow(container);
		container.classList.add(LCARS_BOOTING_CLASS);

		const veil = append(container, $('.lcars-boot-veil'));
		append(veil, $('.lcars-boot-title', undefined, localize('lcarsBootTitle', "LCARS-VSC")));
		append(veil, $('.lcars-boot-subtitle', undefined, localize('lcarsBootSubtitle', "Initializing Interface")));
		const bar = append(veil, $('.lcars-boot-bar'));
		for (let i = 0; i < RIBBON_COLORS.length; i++) {
			append(bar, $(`.lcars-boot-bar-segment.lcars-color-${RIBBON_COLORS[i]}`)).style.animationDelay = `${i * 0.18}s`;
		}

		const finish = () => {
			container.classList.remove(LCARS_BOOTING_CLASS);
			veil.remove();
		};
		const handle = window.setTimeout(finish, BOOT_DURATION_MS);
		this._register(toDisposable(() => {
			window.clearTimeout(handle);
			finish();
		}));
	}

	private registerStardate(statusbarService: IStatusbarService): void {
		const computeText = () => localize('lcarsStardate', "Stardate {0}", LcarsContribution.stardate(new Date()));
		const entry = this._register(statusbarService.addEntry({
			name: localize('lcarsStardateName', "Stardate"),
			text: computeText(),
			ariaLabel: computeText(),
			tooltip: localize('lcarsStardateTooltip', "Current stardate"),
		}, 'lcars.stardate', StatusbarAlignment.RIGHT, 1000));

		const window = getWindow(this.layoutService.mainContainer);
		const handle = window.setInterval(() => {
			const text = computeText();
			entry.update({ name: localize('lcarsStardateName', "Stardate"), text, ariaLabel: text });
		}, 8640); // one stardate unit tick (a tenth of a unit is 8.64 seconds)
		this._register(toDisposable(() => window.clearInterval(handle)));
	}

	private static stardate(date: Date): string {
		const year = date.getFullYear();
		const start = new Date(year, 0, 1).getTime();
		const end = new Date(year + 1, 0, 1).getTime();
		const fraction = (date.getTime() - start) / (end - start);
		return ((year - 1947) * 1000 + fraction * 1000).toFixed(1);
	}
}

registerWorkbenchContribution2(LcarsContribution.ID, LcarsContribution, WorkbenchPhase.BlockRestore);

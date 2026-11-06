/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/lcars.css';
import { getWindow } from '../../../../base/browser/dom.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { registerColor } from '../../../../platform/theme/common/colorRegistry.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IWorkbenchLayoutService, LayoutSettings, Parts } from '../../../services/layout/browser/layoutService.js';
import { LcarsFrame } from './lcarsFrame.js';
import { LcarsBootScreen } from './lcarsBootScreen.js';

const LCARS_CLASS = 'lcars';
const LCARS_ANIMATED_CLASS = 'lcars-animated';
const LCARS_BOOTING_CLASS = 'lcars-booting';

const ENABLE_ANIMATIONS_SETTING = 'lcars.animations.enabled';
const ENABLE_BOOT_SETTING = 'lcars.animations.bootSequence';
const AUTO_HIDE_TITLEBAR_SETTING = 'lcars.titleBar.autoHide';

registerColor('lcars.startupPromptForeground', { dark: '#777777', light: '#777777', hcDark: '#FFFFFF', hcLight: '#FFFFFF' }, localize('lcars.startupPromptForeground', "Foreground color of the LCARS startup prompt."));

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'lcars',
	order: 1,
	title: localize('lcarsConfigurationTitle', "LCARS"),
	type: 'object',
	properties: {
		[LayoutSettings.LCARS_FRAME]: {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.APPLICATION,
			markdownDescription: localize('lcars.frame.enabled', "Controls whether the LCARS frame encloses the editor: the activity bar and primary side bar run down to the bottom of the window, the side bar curves into the editor tabs and the status bar, and status bar items start after that curve. Requires {0} to be off.", '`#workbench.experimental.modernUI#`'),
		},
		[ENABLE_ANIMATIONS_SETTING]: {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.APPLICATION,
			description: localize('lcars.animations.enabled', "Controls whether the LCARS interface animates its panels and controls."),
		},
		[ENABLE_BOOT_SETTING]: {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.APPLICATION,
			description: localize('lcars.animations.bootSequence', "Controls whether startup waits for a keypress or click before initializing the interface. Escape enters immediately. Animations respect reduced motion."),
		},
		[AUTO_HIDE_TITLEBAR_SETTING]: {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.APPLICATION,
			description: localize('lcars.titleBar.autoHide', "Hides the custom title bar controls until the title bar is hovered or receives keyboard focus. Keeps the top spacing reserved to avoid moving the editor. Native OS window controls cannot be hidden this way."),
		}
	}
});

// The LCARS frame is drawn around the classic, edge-to-edge layout with tabs as thin as its bars.
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerDefaultConfigurations([{
	overrides: {
		[LayoutSettings.MODERN_UI]: false,
		'window.density.editorTabHeight': 'compact'
	}
}]);

/** Applies LCARS styling and the boot sequence to the workbench. */
class LcarsContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.lcars';

	constructor(
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IContextMenuService contextMenuService: IContextMenuService,
	) {
		super();

		const container = this.layoutService.mainContainer;
		container.classList.add(LCARS_CLASS);
		this._register(toDisposable(() => container.classList.remove(LCARS_CLASS, LCARS_ANIMATED_CLASS, LCARS_BOOTING_CLASS, 'lcars-titlebar-auto-hide', 'lcars-titlebar-menu-open')));

		this.updateAnimations();
		this.updateTitlebar();
		this._register(contextMenuService.onDidShowContextMenu(() => {
			const titlebar = this.layoutService.getContainer(getWindow(container), Parts.TITLEBAR_PART);
			if (titlebar?.matches(':hover, :focus-within') || titlebar?.classList.contains('menubar-focused')) {
				container.classList.add('lcars-titlebar-menu-open');
			}
		}));
		this._register(contextMenuService.onDidHideContextMenu(() => container.classList.remove('lcars-titlebar-menu-open')));
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(ENABLE_ANIMATIONS_SETTING)) {
				this.updateAnimations();
			}
			if (e.affectsConfiguration(AUTO_HIDE_TITLEBAR_SETTING)) {
				this.updateTitlebar();
			}
		}));

		this.playBootSequence(container);
	}

	private animationsEnabled(): boolean {
		const window = getWindow(this.layoutService.mainContainer);
		return this.configurationService.getValue<boolean>(ENABLE_ANIMATIONS_SETTING) !== false
			&& !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	}

	private updateAnimations(): void {
		const container = this.layoutService.mainContainer;
		container.classList.toggle(LCARS_ANIMATED_CLASS, this.animationsEnabled());
	}

	private playBootSequence(container: HTMLElement): void {
		if (this.configurationService.getValue<boolean>(ENABLE_BOOT_SETTING) === false) {
			return;
		}

		this._register(new LcarsBootScreen(container, () => this.animationsEnabled(), () => {
			this.layoutService.focusPart(Parts.EDITOR_PART, getWindow(container));
		}));
	}

	private updateTitlebar(): void {
		this.layoutService.mainContainer.classList.toggle('lcars-titlebar-auto-hide', this.configurationService.getValue<boolean>(AUTO_HIDE_TITLEBAR_SETTING) === true);
	}
}

registerWorkbenchContribution2(LcarsContribution.ID, LcarsContribution, WorkbenchPhase.BlockRestore);
registerWorkbenchContribution2(LcarsFrame.ID, LcarsFrame, WorkbenchPhase.BlockRestore);

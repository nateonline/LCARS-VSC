/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { $, append } from '../../../../base/browser/dom.js';
import { mainWindow } from '../../../../base/browser/window.js';
import { Event } from '../../../../base/common/event.js';
import { toDisposable } from '../../../../base/common/lifecycle.js';
import { assertReturnsDefined } from '../../../../base/common/types.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { mock } from '../../../../base/test/common/mock.js';
import { IViewDescriptorService, ViewContainerLocation } from '../../../common/views.js';
import { PanelPart } from '../../../browser/parts/panel/panelPart.js';
import { AuxiliaryBarPart } from '../../../browser/parts/auxiliarybar/auxiliaryBarPart.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../platform/configuration/test/common/testConfigurationService.js';
import { IWorkbenchLayoutService, Parts, Position } from '../../../services/layout/browser/layoutService.js';
import { TestLayoutService, workbenchInstantiationService } from '../workbenchTestServices.js';

class TestPaneCompositeLayoutService extends TestLayoutService {

	floatingPanelsEnabled = false;
	modernUICompact = false;
	panelPosition = Position.BOTTOM;
	auxiliaryVisible = false;

	private readonly visibleParts = new Set<Parts>([
		Parts.EDITOR_PART,
		Parts.PANEL_PART,
		Parts.STATUSBAR_PART,
	]);

	constructor(private readonly container: HTMLElement) {
		super();
		this.mainContainer = container;
		this.activeContainer = container;
		this.containers = [container];
	}

	override isFloatingPanelsEnabled(): boolean { return this.floatingPanelsEnabled; }
	override isModernUICompact(): boolean { return this.modernUICompact; }
	override getPanelPosition(): Position { return this.panelPosition; }
	override isVisible(part: Parts): boolean { return part === Parts.AUXILIARYBAR_PART ? this.auxiliaryVisible : this.visibleParts.has(part); }
	override getContainer(): HTMLElement { return this.container; }
}

class TestViewDescriptorService extends mock<IViewDescriptorService>() {
	override readonly onDidChangeViewContainers = Event.None;
	override readonly onDidChangeContainerLocation = Event.None;

	override canMoveViews(): boolean {
		return false;
	}

	override getDefaultViewContainer(_location: ViewContainerLocation) {
		return undefined;
	}

	override getViewContainersByLocation(_location: ViewContainerLocation) {
		return [];
	}
}

class TestPanelPart extends PanelPart {

	floatingBorderWidth = 1;

	override setHeaderArea(header: HTMLElement): void {
		super.setHeaderArea(header);
	}

	protected override getFloatingBorderWidth(): number {
		return this.floatingBorderWidth;
	}

	get floatingContentDimension() {
		return assertReturnsDefined(this.contentDimension);
	}
}

class TestAuxiliaryBarPart extends AuxiliaryBarPart {
	override setHeaderArea(header: HTMLElement): void {
		super.setHeaderArea(header);
	}

	get layoutContentDimension() {
		return assertReturnsDefined(this.contentDimension);
	}
}

suite('Pane composite part layout', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('reserves LCARS rails once across resizing, internal relayout and frame toggles', async () => {
		const root = append(mainWindow.document.body, $('.monaco-workbench'));
		store.add(toDisposable(() => root.remove()));
		const layoutService = new TestPaneCompositeLayoutService(root);
		layoutService.auxiliaryVisible = true;
		const configurationService = new TestConfigurationService({ 'lcars.frame.enabled': true });
		const instantiationService = workbenchInstantiationService(undefined, store);
		instantiationService.stub(IWorkbenchLayoutService, layoutService);
		instantiationService.stub(IConfigurationService, configurationService);
		instantiationService.stub(IViewDescriptorService, new TestViewDescriptorService());

		const panel = store.add(instantiationService.createInstance(TestPanelPart));
		const auxiliary = store.add(instantiationService.createInstance(TestAuxiliaryBarPart));
		panel.create(append(root, $('.part.panel')));
		auxiliary.create(append(root, $('.part.auxiliarybar')));

		const captureState = () => ({
			panel: {
				width: panel.floatingContentDimension.width,
				minimumWidth: panel.minimumWidth,
				left: panel.element.style.getPropertyValue('--lcars-content-left'),
				right: panel.element.style.getPropertyValue('--lcars-content-right'),
			},
			auxiliary: {
				width: auxiliary.layoutContentDimension.width,
				height: auxiliary.layoutContentDimension.height,
				frameHeight: auxiliary.element.style.height,
				minimumWidth: auxiliary.minimumWidth,
				left: auxiliary.element.style.getPropertyValue('--lcars-content-left'),
				right: auxiliary.element.style.getPropertyValue('--lcars-content-right'),
				bottom: auxiliary.element.style.getPropertyValue('--lcars-content-bottom'),
			},
		});
		const layout = (width: number) => {
			panel.layout(width, 200, 0, 0);
			auxiliary.layout(width, 200, 0, 0);
			return captureState();
		};

		const initial = layout(400);
		panel.setHeaderArea(append(panel.element, $('.header')));
		auxiliary.setHeaderArea(append(auxiliary.element, $('.header')));
		const internalRelayout = captureState();
		const resized = layout(500);
		await configurationService.setUserConfiguration('lcars.frame.enabled', false);
		const disabled = layout(400);
		await configurationService.setUserConfiguration('lcars.frame.enabled', true);
		const restored = layout(400);
		layoutService.floatingPanelsEnabled = true;
		layout(400);
		const floatingInsets = [panel.element, auxiliary.element].map(element => [
			element.style.getPropertyValue('--lcars-content-left'),
			element.style.getPropertyValue('--lcars-content-right'),
			element.style.getPropertyValue('--lcars-content-bottom'),
		]);

		const framed = {
			panel: { width: 352, minimumWidth: 348, left: '0px', right: '48px' },
			auxiliary: { width: 348, height: 165, frameHeight: '100%', minimumWidth: 222, left: '52px', right: '0px', bottom: '35px' },
		};
		assert.deepStrictEqual({ initial, internalRelayout, resized, disabled, restored, floatingInsets }, {
			initial: framed,
			internalRelayout: framed,
			resized: {
				panel: { width: 452, minimumWidth: 348, left: '0px', right: '48px' },
				auxiliary: { width: 448, height: 165, frameHeight: '100%', minimumWidth: 222, left: '52px', right: '0px', bottom: '35px' },
			},
			disabled: {
				panel: { width: 400, minimumWidth: 300, left: '0px', right: '0px' },
				auxiliary: { width: 400, height: 200, frameHeight: '', minimumWidth: 170, left: '0px', right: '0px', bottom: '0px' },
			},
			restored: framed,
			floatingInsets: [['0px', '0px', '0px'], ['0px', '0px', '0px']],
		});
	});

	test('preserves panel layout across classic and DPR 2.5 floating modes', () => {
		const root = append(mainWindow.document.body, $('.monaco-workbench'));
		store.add(toDisposable(() => root.remove()));
		const container = append(root, $('.part.panel'));
		const layoutService = new TestPaneCompositeLayoutService(root);
		const instantiationService = workbenchInstantiationService(undefined, store);
		instantiationService.stub(IWorkbenchLayoutService, layoutService);
		instantiationService.stub(IViewDescriptorService, new TestViewDescriptorService());

		const part = store.add(instantiationService.createInstance(TestPanelPart));
		part.create(container);
		const devicePixelRatio = 2.5;
		part.floatingBorderWidth = Math.floor(devicePixelRatio) / devicePixelRatio;

		const captureState = () => ({
			height: part.element.style.height,
			contentDimension: {
				width: part.floatingContentDimension.width,
				height: part.floatingContentDimension.height,
			},
			outerEdges: {
				left: part.element.classList.contains('floating-part-outer-left'),
				right: part.element.classList.contains('floating-part-outer-right'),
				top: part.element.classList.contains('floating-part-outer-top'),
				bottom: part.element.classList.contains('floating-part-outer-bottom'),
			},
		});

		layoutService.panelPosition = Position.TOP;
		part.layout(300, 200, 0, 0);
		const classicTop = captureState();

		layoutService.panelPosition = Position.RIGHT;
		part.layout(300, 200, 0, 0);
		const classicRight = captureState();

		layoutService.panelPosition = Position.BOTTOM;
		part.layout(300, 200, 0, 0);
		const classicBottom = captureState();

		layoutService.floatingPanelsEnabled = true;
		part.layout(300, 200, 0, 0);
		const floatingDefault = captureState();

		layoutService.modernUICompact = true;
		part.layout(300, 200, 0, 0);
		const floatingCompact = captureState();

		layoutService.floatingPanelsEnabled = false;
		part.layout(300, 200, 0, 0);
		const restoredClassic = captureState();

		assert.deepStrictEqual({
			classicTop,
			classicRight,
			classicBottom,
			floatingDefault,
			floatingCompact,
			restoredClassic,
		}, {
			classicTop: {
				height: '',
				contentDimension: { width: 300, height: 199 },
				outerEdges: { left: false, right: false, top: false, bottom: false },
			},
			classicRight: {
				height: '',
				contentDimension: { width: 299, height: 200 },
				outerEdges: { left: false, right: false, top: false, bottom: false },
			},
			classicBottom: {
				height: '',
				contentDimension: { width: 300, height: 200 },
				outerEdges: { left: false, right: false, top: false, bottom: false },
			},
			floatingDefault: {
				height: 'calc(100% - 8px)',
				contentDimension: { width: 290.4, height: 190.4 },
				outerEdges: { left: true, right: true, top: false, bottom: true },
			},
			floatingCompact: {
				height: 'calc(100% + 0px)',
				contentDimension: { width: 298.4, height: 198.4 },
				outerEdges: { left: true, right: true, top: false, bottom: true },
			},
			restoredClassic: {
				height: '',
				contentDimension: { width: 300, height: 200 },
				outerEdges: { left: false, right: false, top: false, bottom: false },
			},
		});
	});
});

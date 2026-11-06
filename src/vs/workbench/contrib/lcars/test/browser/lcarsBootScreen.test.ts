/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import sinon from 'sinon';
import { $, append } from '../../../../../base/browser/dom.js';
import { mainWindow } from '../../../../../base/browser/window.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { LcarsBootScreen } from '../../browser/lcarsBootScreen.js';

suite('LCARS boot screen', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function createScreen(animate: boolean) {
		const container = append(mainWindow.document.body, $('.monaco-workbench.lcars'));
		store.add(toDisposable(() => container.remove()));
		const content = append(container, $('.content'));
		const previousFocus = append(content, $('button'));
		previousFocus.focus();
		let initialized = 0;
		let focused = true;
		const screen = store.add(new LcarsBootScreen(container, () => animate, () => initialized++, () => focused));
		return { container, content, previousFocus, screen, initialized: () => initialized, setAnimationsEnabled: (enabled: boolean) => animate = enabled, setFocused: (value: boolean) => focused = value };
	}

	function press(key: string) {
		mainWindow.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
	}

	test('shows only the continuation prompt while waiting', () => {
		const { container } = createScreen(true);
		const veil = container.querySelector<HTMLElement>('.lcars-boot-veil')!;
		assert.deepStrictEqual({
			text: veil.textContent,
			children: veil.children.length,
			prompt: veil.firstElementChild?.classList.contains('lcars-boot-prompt'),
		}, { text: 'Press any button to continue...', children: 1, prompt: true });
	});

	test('accepts every key, including Tab and modifier keys', () => {
		const keys = ['Tab', 'Shift', 'Control', 'Alt', 'Meta', 'Escape', 'a', 'Enter', 'ArrowUp', 'F1'];
		const results = keys.map(key => {
			const { container, initialized } = createScreen(false);
			press(key);
			return [key, !!container.querySelector('.lcars-boot-veil'), initialized()];
		});
		assert.deepStrictEqual(results, keys.map(key => [key, false, 1]));
	});

	test('ignores keyboard input until the app window is focused', () => {
		const { container, initialized, setFocused } = createScreen(false);
		setFocused(false);
		press('Enter');
		const unfocused = [!!container.querySelector('.lcars-boot-veil'), initialized()];
		setFocused(true);
		press('Enter');
		assert.deepStrictEqual({
			unfocused,
			focused: [!!container.querySelector('.lcars-boot-veil'), initialized()],
		}, { unfocused: [true, 0], focused: [false, 1] });
	});

	test('waits indefinitely, consumes input, and completes the animation only once', () => {
		const clock = sinon.useFakeTimers();
		try {
			const { container, content, initialized } = createScreen(true);
			clock.tick(10000);
			const waiting = [!!container.querySelector('.lcars-boot-veil'), container.classList.contains('lcars-booting'), content.inert, initialized()];
			press('Enter');
			clock.tick(2000);
			press('a');
			clock.tick(2200);
			assert.deepStrictEqual({
				waiting,
				finished: [!!container.querySelector('.lcars-boot-veil'), container.classList.contains('lcars-booting'), content.inert, initialized()],
			}, {
				waiting: [true, false, true, 0],
				finished: [false, false, false, 1],
			});
		} finally {
			clock.restore();
		}
	});

	test('accepts a click without animation and restores focus', () => {
		const { container, content, previousFocus, initialized } = createScreen(false);
		container.querySelector<HTMLElement>('.lcars-boot-prompt')!.click();
		assert.deepStrictEqual({
			visible: !!container.querySelector('.lcars-boot-veil'),
			inert: content.inert,
			focusRestored: mainWindow.document.activeElement === previousFocus,
			initialized: initialized(),
		}, { visible: false, inert: false, focusRestored: true, initialized: 1 });
	});

	test('waits for the click to complete before removing the screen without animation', () => {
		const { container, initialized } = createScreen(false);
		mainWindow.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
		const afterPointerDown = [!!container.querySelector('.lcars-boot-veil'), initialized()];
		mainWindow.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
		assert.deepStrictEqual({
			afterPointerDown,
			afterClick: [!!container.querySelector('.lcars-boot-veil'), initialized()],
		}, { afterPointerDown: [true, 0], afterClick: [false, 1] });
	});

	test('lets Tab initialize and Escape skip the animation', () => {
		const { container, initialized } = createScreen(true);
		press('Tab');
		const tabInitialized = container.classList.contains('lcars-booting');
		press('Escape');
		assert.deepStrictEqual({
			tabInitialized,
			visible: !!container.querySelector('.lcars-boot-veil'),
			initialized: initialized(),
		}, { tabInitialized: true, visible: false, initialized: 1 });
	});

	test('honors animation preferences changed while waiting for input', () => {
		const { container, initialized, setAnimationsEnabled } = createScreen(true);
		setAnimationsEnabled(false);
		press('Enter');
		assert.deepStrictEqual({
			visible: !!container.querySelector('.lcars-boot-veil'),
			initialized: initialized(),
		}, { visible: false, initialized: 1 });
	});

	test('isolates newly restored workbench children and preserves their inert state on disposal', async () => {
		const { container, screen, initialized } = createScreen(true);
		const restored = append(container, $('.restored'));
		const alreadyInert = append(container, $('.inert'));
		alreadyInert.inert = true;
		await Promise.resolve();
		const isolated = restored.inert;
		screen.dispose();
		assert.deepStrictEqual({
			isolated,
			restored: restored.inert,
			alreadyInert: alreadyInert.inert,
			visible: !!container.querySelector('.lcars-boot-veil'),
			initialized: initialized(),
		}, { isolated: true, restored: false, alreadyInert: true, visible: false, initialized: 0 });
	});
});

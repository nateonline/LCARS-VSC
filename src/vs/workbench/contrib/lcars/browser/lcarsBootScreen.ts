/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, EventType, getWindow, isHTMLElement } from '../../../../base/browser/dom.js';
import { Button } from '../../../../base/browser/ui/button/button.js';
import { Disposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { defaultButtonStyles } from '../../../../platform/theme/browser/defaultStyles.js';

const BOOT_DURATION_MS = 4200;
const BOOT_COLORS = ['orange', 'peach', 'lavender', 'blue', 'magenta', 'tan', 'purple', 'red'];

/** Holds the startup screen until input, then reveals the workbench. */
export class LcarsBootScreen extends Disposable {

	private initializing = false;
	private finished = false;

	constructor(container: HTMLElement, shouldAnimate: () => boolean, onDidInitialize: () => void, hasFocus: () => boolean = () => getWindow(container).document.hasFocus()) {
		super();

		const window = getWindow(container);
		const previousFocus = container.ownerDocument.activeElement;
		const veil = append(container, $('.lcars-boot-veil'));
		veil.setAttribute('role', 'dialog');
		veil.setAttribute('aria-modal', 'true');
		veil.setAttribute('aria-label', localize('lcarsBootLabel', "LCARS startup"));
		const prompt = this._register(new Button(veil, {
			...defaultButtonStyles,
			buttonBackground: undefined,
			buttonHoverBackground: undefined,
			buttonForeground: undefined,
			buttonBorder: undefined,
		}));
		prompt.element.classList.add('lcars-boot-prompt');
		prompt.label = localize('lcarsBootPrompt', "Press any button to continue...");
		prompt.element.setAttribute('aria-description', localize('lcarsBootInstructions', "Press a key or click to initialize. Press Escape to skip the animation and enter the editor."));

		const inertElements = new Map<HTMLElement, boolean>();
		const isolateWorkbench = () => {
			for (const child of container.children) {
				if (isHTMLElement(child) && child !== veil && !inertElements.has(child)) {
					inertElements.set(child, child.inert);
					child.inert = true;
				}
			}
		};
		const observer = new window.MutationObserver(isolateWorkbench);
		this._register(toDisposable(() => observer.disconnect()));
		observer.observe(container, { childList: true });
		isolateWorkbench();

		let handle: number | undefined;
		this._register(toDisposable(() => {
			window.clearTimeout(handle);
			container.classList.remove('lcars-booting');
			veil.remove();
			for (const [element, inert] of inertElements) {
				element.inert = inert;
			}
			if (isHTMLElement(previousFocus) && previousFocus.isConnected) {
				previousFocus.focus();
			}
		}));

		const finish = () => {
			if (this.finished) {
				return;
			}
			this.finished = true;
			this.dispose();
			onDidInitialize();
		};
		const initialize = () => {
			if (this.initializing) {
				return;
			}
			this.initializing = true;
			if (!shouldAnimate()) {
				finish();
				return;
			}
			append(veil, $('.lcars-boot-title', undefined, localize('lcarsBootTitle', "LCARS-VSC")));
			append(veil, $('.lcars-boot-subtitle', undefined, localize('lcarsBootSubtitle', "Initializing Interface")));
			const bar = append(veil, $('.lcars-boot-bar'));
			bar.setAttribute('aria-hidden', 'true');
			for (let i = 0; i < BOOT_COLORS.length; i++) {
				append(bar, $(`.lcars-boot-bar-segment.lcars-color-${BOOT_COLORS[i]}`)).style.animationDelay = `${i * 0.18}s`;
			}
			veil.appendChild(prompt.element);
			veil.classList.add('lcars-boot-initializing');
			container.classList.add('lcars-booting');
			handle = window.setTimeout(finish, BOOT_DURATION_MS);
		};
		this._register(addDisposableListener(window, 'pointerdown', e => {
			e.preventDefault();
			e.stopImmediatePropagation();
		}, true));
		this._register(addDisposableListener(window, EventType.CLICK, e => {
			e.preventDefault();
			e.stopImmediatePropagation();
			initialize();
		}, true));
		this._register(addDisposableListener(window, EventType.CONTEXT_MENU, e => {
			e.preventDefault();
			e.stopImmediatePropagation();
			initialize();
		}, true));
		this._register(addDisposableListener(window, EventType.KEY_DOWN, e => {
			if (!hasFocus() || (e.altKey && e.key === 'F4')) {
				return;
			}
			e.preventDefault();
			e.stopImmediatePropagation();
			if (e.key === 'Escape') {
				finish();
			} else {
				initialize();
			}
		}, true));
		prompt.focus();
	}
}

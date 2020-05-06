import {
    window,
    StatusBarAlignment,
    StatusBarItem,
    EventEmitter,
    Uri,
    commands,
    env,
} from "vscode";

import { debounce } from "./Debounce";
import * as p4 from "./api/PerforceApi";
import * as PerforceUri from "./PerforceUri";
import { isPositiveOrZero } from "./TsUtils";

let _statusBarItem: StatusBarItem;

export enum ActiveEditorStatus {
    OPEN = "OPEN",
    NOT_OPEN = "NOT_OPEN",
    NOT_IN_WORKSPACE = "NOT_IN_WORKSPACE",
}

export interface ActiveStatusEvent {
    file: Uri;
    status: ActiveEditorStatus;
    details?: p4.OpenedFile;
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace Display {
    export const channel = window.createOutputChannel("Perforce Log");

    let _lastStatusEvent: ActiveStatusEvent | undefined;

    const _onActiveFileStatusKnown = new EventEmitter<ActiveStatusEvent>();
    export const onActiveFileStatusKnown = _onActiveFileStatusKnown.event;
    const _onActiveFileStatusCleared = new EventEmitter<Uri | undefined>();
    export const onActiveFileStatusCleared = _onActiveFileStatusCleared.event;

    let _statusBarActivated = false;

    export const updateEditor = debounce(updateEditorImpl, 1000, () => {
        if (!_statusBarActivated) {
            return;
        }
        _lastStatusEvent = undefined;
        _onActiveFileStatusCleared.fire(window.activeTextEditor?.document.uri);
        if (_statusBarItem) {
            _statusBarItem.show();
            _statusBarItem.text = "P4: $(sync~spin)";
            _statusBarItem.tooltip = "Checking file status";
        }
    });

    export function initialize(subscriptions: { dispose(): any }[]) {
        subscriptions.push(commands.registerCommand("perforce.showOutput", showOutput));
        subscriptions.push(channel);

        _statusBarItem = window.createStatusBarItem(
            StatusBarAlignment.Left,
            Number.MIN_VALUE
        );

        _statusBarItem.command = "perforce.menuFunctions";
        subscriptions.push(_statusBarItem);
        subscriptions.push(_onActiveFileStatusKnown);
        subscriptions.push(_onActiveFileStatusCleared);

        subscriptions.push(window.onDidChangeActiveTextEditor(updateEditor));

        updateEditor();
    }

    export function getLastActiveFileStatus() {
        return _lastStatusEvent;
    }

    export function activateStatusBar() {
        if (!_statusBarActivated) {
            _statusBarActivated = true;
            updateEditor();
        }
    }

    function showOutput() {
        Display.channel.show();
    }

    async function updateEditorImpl() {
        if (!_statusBarActivated) {
            return;
        }

        const editor = window.activeTextEditor;
        if (!editor) {
            if (_statusBarItem) {
                _statusBarItem.hide();
            }
            return;
        }

        const doc = editor.document;

        if (!doc.isUntitled) {
            let active: ActiveEditorStatus = ActiveEditorStatus.NOT_IN_WORKSPACE;
            let details: p4.OpenedFile | undefined;
            try {
                const opened = await p4.getOpenedFileDetails(doc.uri, {
                    files: [doc.uri],
                });
                if (opened.open.length > 0) {
                    _statusBarItem.text = "P4: $(check)";
                    _statusBarItem.tooltip = opened.open[0].message;
                    active = ActiveEditorStatus.OPEN;
                    details = opened.open[0];
                } else if (opened.unopen.length > 0) {
                    const inRoot =
                        opened.unopen[0].reason === p4.UnopenedFileReason.NOT_OPENED;
                    _statusBarItem.text = inRoot
                        ? "P4: $(file-text)"
                        : "P4: $(circle-slash)";
                    _statusBarItem.tooltip = opened.unopen[0].message;
                    active = inRoot
                        ? ActiveEditorStatus.NOT_OPEN
                        : ActiveEditorStatus.NOT_IN_WORKSPACE;
                } else {
                    _statusBarItem.text = "P4: $(circle-slash)";
                    _statusBarItem.tooltip = "unknown";
                    active = ActiveEditorStatus.NOT_IN_WORKSPACE;
                }
            } catch (err) {
                // file not under client root
                _statusBarItem.text = "P4: $(circle-slash)";
                _statusBarItem.tooltip = err.toString();
                active = ActiveEditorStatus.NOT_IN_WORKSPACE;
            }

            _lastStatusEvent = { file: doc.uri, status: active, details };
            _onActiveFileStatusKnown.fire(_lastStatusEvent);
        } else {
            _statusBarItem.hide();
        }
    }

    async function isSameAsOpenHaveFile(uri: Uri) {
        const open = window.activeTextEditor?.document.uri;
        if (!open || !PerforceUri.isDepotUri(uri)) {
            return false;
        }
        const have = await p4.have(open, { file: open });
        if (have) {
            return have.depotPath === PerforceUri.getDepotPathFromDepotUri(uri);
        }
        return false;
    }

    function isSameAsOpenFileByStatus(uri: Uri) {
        const open = window.activeTextEditor?.document.uri;
        if (!open || !PerforceUri.isDepotUri(uri)) {
            return false;
        }

        const path = Display.getLastActiveFileStatus()?.details?.depotPath;
        return path && path === PerforceUri.getDepotPathFromDepotUri(uri);
    }

    export async function isSameAsOpenFile(uri: Uri) {
        const open = window.activeTextEditor?.document.uri;
        if (!open) {
            return false;
        }

        return (
            PerforceUri.isSameFileOrDepotPath(uri, open) ||
            isSameAsOpenFileByStatus(uri) ||
            (await isSameAsOpenHaveFile(uri))
        );
    }

    export function showMessage(message: string) {
        window.setStatusBarMessage("Perforce: " + message.replace(/\r?\n/g, " "), 3000);
        channel.append(message + "\n");
    }

    export function showModalMessage(message: string) {
        window.showInformationMessage(message, { modal: true });
    }

    export async function requestConfirmation(message: string, yes: string) {
        const chosen = await window.showWarningMessage(message, { modal: true }, yes);
        return chosen === yes;
    }

    export function showError(error: string) {
        window.setStatusBarMessage("Perforce: " + error.replace(/\r?\n/g, " "), 3000);
        channel.appendLine(`ERROR: ${JSON.stringify(error)}`);
    }

    export function showImportantError(error: string) {
        window.showErrorMessage(error);
        channel.appendLine(`ERROR: ${JSON.stringify(error)}`);
    }

    export async function doLoginFlow(resource: Uri) {
        let loggedIn = await p4.isLoggedIn(resource);
        if (!loggedIn) {
            const password = await window.showInputBox({
                prompt: "Enter password",
                password: true,
            });
            if (password) {
                try {
                    await p4.login(resource, { password });

                    Display.showMessage("Login successful");
                    Display.updateEditor();
                    loggedIn = true;
                } catch {}
            }
        } else {
            Display.showMessage("Login successful");
            Display.updateEditor();
            loggedIn = true;
        }
        return loggedIn;
    }

    export async function doLogoutFlow(resource: Uri) {
        try {
            await p4.logout(resource, {});
            Display.showMessage("Logout successful");
            Display.updateEditor();
            return true;
        } catch {}
        return false;
    }

    async function trimmedClipValue() {
        const clipValue = await env.clipboard.readText();
        return clipValue.trim();
    }

    export async function requestChangelistNumber() {
        const clipValue = await trimmedClipValue();
        const value = isPositiveOrZero(clipValue) ? clipValue : undefined;

        return await window.showInputBox({
            placeHolder: "Changelist number",
            prompt: "Enter a changelist number",
            value,
            validateInput: (value) => {
                if (!isPositiveOrZero(value)) {
                    return "must be a positive number";
                }
            },
        });
    }

    export async function requestJobId() {
        const clipValue = await trimmedClipValue();
        const value = /^[a-zA-Z]+[0-9]+[a-zA-Z0-9]*$/.test(clipValue)
            ? clipValue
            : undefined;
        return await window.showInputBox({
            placeHolder: "job00000n",
            prompt: "Enter a job",
            value,
        });
    }
}

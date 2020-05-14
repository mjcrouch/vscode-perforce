import * as vscode from "vscode";
import { isTruthy } from "../TsUtils";
import { Display } from "../Display";
import * as PerforceUri from "../PerforceUri";

export function asUri(uri: vscode.Uri | string) {
    if (typeof uri === "string") {
        return PerforceUri.parse(uri);
    }
    return uri;
}

export type ActionableQuickPick = {
    items: ActionableQuickPickItem[];
    excludeFromHistory?: boolean;
    placeHolder: string;
    recentKey?: string;
};

export interface ActionableQuickPickProvider {
    provideActions: (...args: any) => Promise<ActionableQuickPick>;
}

export interface ActionableQuickPickItem extends vscode.QuickPickItem {
    performAction?: (reopen: () => void) => void | Promise<any>;
}

const registeredQuickPickProviders = new Map<string, ActionableQuickPickProvider>();

type QuickPickInstance = {
    type: string;
    args: any[];
    description: string;
    recentKey: string;
};

const quickPickStack: QuickPickInstance[] = [];
// unique recent items by recentKey
let recents: QuickPickInstance[] = [];

export function registerQuickPickProvider(
    type: string,
    provider: ActionableQuickPickProvider
) {
    registeredQuickPickProviders.set(type, provider);
}

const backLabel = "$(discard) Go Back";

export function openLastQuickPick() {
    const prev = quickPickStack[quickPickStack.length - 1];
    if (prev) {
        quickPickStack.pop();
        showQuickPick(prev.type, ...prev.args);
    } else {
        Display.showImportantError("No previous quick pick available");
    }
}

function addToRecentQuickPicks(qp: QuickPickInstance) {
    const found = recents.findIndex((r) => qp.recentKey === r.recentKey);
    if (found >= 0) {
        recents.splice(found, 1);
    }
    recents = [qp, ...recents.slice(0, 49)];
}

export async function chooseRecentQuickPick() {
    const items = recents.map((r) => {
        return {
            label: r.description,
            value: r,
        };
    });

    const chosen = await vscode.window.showQuickPick(items, {
        placeHolder: "Choose a recent quick pick to open",
        matchOnDescription: true,
    });

    if (chosen) {
        showQuickPick(chosen.value.type, ...chosen.value.args);
    }
}

function makeStackActions(): ActionableQuickPickItem[] {
    const prev = quickPickStack[quickPickStack.length - 1];
    return [
        prev
            ? {
                  label: backLabel,
                  description: "to " + prev.description,
                  performAction: () => {
                      openLastQuickPick();
                  },
              }
            : {
                  label: backLabel,
                  description: "n/a",
              },
    ].filter(isTruthy);
}

export async function showQuickPick(type: string, ...args: any[]) {
    const provider = registeredQuickPickProviders.get(type);

    if (provider) {
        const actions = await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Window,
                title: "Getting actions for quick pick",
                cancellable: false,
            },
            () => provider.provideActions(...args)
        );

        const instance: QuickPickInstance = {
            type,
            args,
            description: actions.placeHolder,
            recentKey: actions.recentKey ?? actions.placeHolder,
        };
        if (!actions.excludeFromHistory) {
            addToRecentQuickPicks(instance);
        }

        const curAction: ActionableQuickPickItem = {
            label: "$(location) " + actions.placeHolder,
        };
        const stackActions = makeStackActions();

        const picked = await vscode.window.showQuickPick(
            [...stackActions, curAction, ...actions.items],
            {
                //ignoreFocusOut: true,
                matchOnDescription: true,
                matchOnDetail: true,
                placeHolder: actions.placeHolder,
            }
        );

        const isNoOp = picked && !picked.performAction;
        if (isNoOp) {
            // show own menu again, without adding this one to the stack
            await showQuickPick(type, ...args);
            return;
        }

        const addToStack = backLabel !== picked?.label && !actions.excludeFromHistory;
        if (addToStack) {
            quickPickStack.push(instance);
        }

        const reopen = () => {
            if (addToStack) {
                quickPickStack.pop();
            }
            showQuickPick(type, ...args);
        };
        await picked?.performAction?.(reopen);
    } else {
        throw new Error("No registered quick pick provider for type " + type);
    }
}

export function toRevString(startRev: string | undefined, endRev: string) {
    return startRev ? startRev + "," + endRev : endRev;
}

export function makeClipPick(
    name: string,
    value: string | undefined
): ActionableQuickPickItem {
    const val = value ?? "";
    return {
        label: "$(clippy) Copy " + name + " to clipboard",
        description: val,
        performAction: (reopen) => {
            vscode.env.clipboard.writeText(val);
            vscode.window.setStatusBarMessage("Copied to clipboard");
            reopen();
        },
    };
}

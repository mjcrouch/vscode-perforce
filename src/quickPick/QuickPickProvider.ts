import * as vscode from "vscode";
import { isTruthy } from "../TsUtils";

export type ActionableQuickPick = {
    items: ActionableQuickPickItem[];
    placeHolder: string;
};

export interface ActionableQuickPickProvider {
    provideActions: (...args: any) => Promise<ActionableQuickPick>;
}

export interface ActionableQuickPickItem extends vscode.QuickPickItem {
    performAction: () => void | Promise<any>;
}

const registeredQuickPickProviders = new Map<string, ActionableQuickPickProvider>();

type QuickPickInstance = {
    type: string;
    args: any[];
    description: string;
};

const quickPickStack: QuickPickInstance[] = [];

export function registerQuickPickProvider(
    type: string,
    provider: ActionableQuickPickProvider
) {
    registeredQuickPickProviders.set(type, provider);
}

function makeStackActions(): ActionableQuickPickItem[] {
    const prev = quickPickStack[quickPickStack.length - 1];
    return [
        prev
            ? {
                  label: "$(discard) Go Back",
                  description: prev.description,
                  performAction: () => {
                      quickPickStack.pop();
                      showQuickPickImpl(prev.type, true, ...prev.args);
                  }
              }
            : undefined
    ].filter(isTruthy);
}

export async function showQuickPick(type: string, ...args: any[]) {
    await showQuickPickImpl(type, false, ...args);
}

async function showQuickPickImpl(type: string, goingBack: boolean, ...args: any[]) {
    const provider = registeredQuickPickProviders.get(type);

    if (provider) {
        const actions = await provider.provideActions(...args);

        const picked = await vscode.window.showQuickPick(
            actions.items.concat(makeStackActions()),
            {
                //ignoreFocusOut: true,
                placeHolder: actions.placeHolder
            }
        );

        if (!goingBack) {
            // TODO - don't push if the args are the same - may need some kind of comparator
            quickPickStack.push({ type, args, description: actions.placeHolder });
        }

        await picked?.performAction();
    } else {
        throw new Error("No registered quick pick provider for type " + type);
    }
}

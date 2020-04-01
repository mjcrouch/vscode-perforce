import * as vscode from "vscode";
import { isTruthy } from "../TsUtils";

export type ActionableQuickPick = {
    items: ActionableQuickPickItem[];
    excludeFromHistory?: boolean;
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

const backLabel = "$(discard) Go Back";

function makeStackActions(type: string, ...args: any[]): ActionableQuickPickItem[] {
    const prev = quickPickStack[quickPickStack.length - 1];
    return [
        prev
            ? {
                  label: backLabel,
                  description: "to " + prev.description,
                  performAction: () => {
                      showQuickPickImpl(prev.type, false, ...prev.args);
                  }
              }
            : {
                  label: backLabel,
                  description: "n/a",
                  performAction: () => {
                      showQuickPickImpl(type, true, ...args);
                  }
              }
    ].filter(isTruthy);
}

export async function showQuickPick(type: string, ...args: any[]) {
    await showQuickPickImpl(type, false, ...args);
}

async function showQuickPickImpl(
    type: string,
    excludeFromHistory: boolean,
    ...args: any[]
) {
    const provider = registeredQuickPickProviders.get(type);

    if (provider) {
        const actions = await provider.provideActions(...args);
        const excludeFromStack = excludeFromHistory || !!actions.excludeFromHistory;
        const stackActions = makeStackActions(type, ...args);

        const picked = await vscode.window.showQuickPick(
            stackActions.concat(actions.items),
            {
                //ignoreFocusOut: true,
                matchOnDescription: true,
                matchOnDetail: true,
                placeHolder: actions.placeHolder
            }
        );

        if (backLabel !== picked?.label && !excludeFromStack) {
            quickPickStack.push({ type, args, description: actions.placeHolder });
        } else if (backLabel === picked?.label) {
            quickPickStack.pop();
        }

        await picked?.performAction();
    } else {
        throw new Error("No registered quick pick provider for type " + type);
    }
}

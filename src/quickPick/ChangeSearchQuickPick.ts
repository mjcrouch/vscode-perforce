import * as vscode from "vscode";

import * as qp from "./QuickPickProvider";
import { ChangeInfo } from "../api/CommonTypes";
import { showQuickPickForChangelist } from "./ChangeQuickPick";

export const changeSearchQuickPickProvider: qp.ActionableQuickPickProvider = {
    provideActions: (
        resource: vscode.Uri,
        title: string,
        results: ChangeInfo[]
    ): Promise<qp.ActionableQuickPick> => {
        const items: vscode.QuickPickItem[] = results.map((change) => {
            const statusIcon = change.isPending ? "$(tools)" : "$(check)";
            return {
                label: change.chnum,
                description:
                    "$(person) " +
                    change.user +
                    " " +
                    statusIcon +
                    " " +
                    change.description.join(" "),
                performAction: () => {
                    showQuickPickForChangelist(resource, change.chnum);
                },
            };
        });

        return Promise.resolve({
            items,
            placeHolder: "Search Results: " + title,
        });
    },
};

export async function showQuickPickForChangeSearch(
    resource: vscode.Uri,
    title: string,
    results: ChangeInfo[]
) {
    await qp.showQuickPick("changeResults", resource, title, results);
}

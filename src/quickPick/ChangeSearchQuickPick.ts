import * as vscode from "vscode";

import * as qp from "./QuickPickProvider";
import { ChangeInfo } from "../api/CommonTypes";
import { showQuickPickForChangelist } from "./ChangeQuickPick";
import { Filters, makeFilterLabelText } from "../search/Filters";

export const changeSearchQuickPickProvider: qp.ActionableQuickPickProvider = {
    provideActions: (
        resource: vscode.Uri,
        filters: Filters,
        results: ChangeInfo[]
    ): Promise<qp.ActionableQuickPick> => {
        const items: vscode.QuickPickItem[] = results.map((change) => {
            const statusIcon = change.status === "pending" ? "$(tools)" : "$(check)";
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

        const title = makeFilterLabelText(filters, results.length);

        return Promise.resolve({
            items,
            placeHolder: "Search Results: " + title,
        });
    },
};

export async function showQuickPickForChangeSearch(
    resource: vscode.Uri,
    filters: Filters,
    results: ChangeInfo[]
) {
    await qp.showQuickPick("changeResults", resource, filters, results);
}

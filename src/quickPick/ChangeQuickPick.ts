import * as vscode from "vscode";

import * as PerforceUri from "../PerforceUri";
import * as p4 from "../api/PerforceApi";
import * as DiffProvider from "../DiffProvider";
import { Display } from "../Display";
import { AnnotationProvider } from "../annotations/AnnotationProvider";
import { isTruthy } from "../TsUtils";

import * as qp from "./QuickPickProvider";

export const changeQuickPickProvider: qp.ActionableQuickPickProvider = {
    provideActions: (chnum: string) => {
        return Promise.resolve({
            items: [],
            placeHolder: "TODO"
        });
    }
};

export async function showQuickPickForChangelist(chnum: string) {
    await qp.showQuickPick("change", chnum);
}

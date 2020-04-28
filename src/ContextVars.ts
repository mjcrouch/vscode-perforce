import { Display, ActiveStatusEvent } from "./Display";
import * as vscode from "vscode";
import * as PerforceUri from "./PerforceUri";

const makeDefault = () => {
    return {
        status: "",
        depotPath: "",
        revision: "",
        changelist: "",
        operation: "",
        filetype: "",
        message: "",
        hasRevision: false,
        resourceRevision: "",
    };
};

type ContextVars = Record<keyof ReturnType<typeof makeDefault>, string | boolean>;

export function initialize(subscriptions: vscode.Disposable[]) {
    subscriptions.push(Display.onActiveFileStatusKnown(setContextVars));
    subscriptions.push(Display.onActiveFileStatusCleared(clearContextVars));
    subscriptions.push(...Object.keys(makeDefault()).map(registerContextVar));
}

function registerContextVar(name: string) {
    return vscode.commands.registerCommand("perforce.currentFile." + name, () =>
        getFileContext(name as keyof ContextVars)
    );
}

let fileContext: ContextVars = makeDefault();

function getFileContext(arg: keyof ContextVars) {
    return fileContext[arg] ?? "";
}

function getRevision(file?: vscode.Uri) {
    if (!file) {
        return -1;
    }
    const fileRev = parseInt(PerforceUri.getRevOrAtLabel(file));
    if (isNaN(fileRev)) {
        return -1;
    }
    return fileRev;
}

function calculateDiffOptions(file?: vscode.Uri) {
    const rev = getRevision(file);
    const hasRevision = rev > 0;
    const resourceRevision = rev.toString();

    // show next diff button only for diffs (including diffs without a revision - for consistent button placement)
    return {
        hasRevision,
        resourceRevision,
    };
}

function setContextVars(event: ActiveStatusEvent) {
    const diffOptions = calculateDiffOptions(event.file);

    fileContext = {
        status: event.status.toString(),
        depotPath: event.details?.depotPath ?? "",
        revision: event.details?.revision ?? "",
        changelist: event.details?.chnum ?? "",
        operation: event.details?.operation ?? "",
        filetype: event.details?.filetype ?? "",
        message: event.details?.message ?? "",
        ...diffOptions,
    };

    Object.entries(fileContext).forEach((c) => {
        vscode.commands.executeCommand(
            "setContext",
            "perforce.currentFile." + c[0],
            c[1]
        );
    });
}

function clearContextVars(file?: vscode.Uri) {
    fileContext = makeDefault();

    const diffOptions = calculateDiffOptions(file);

    const all = { ...fileContext, ...diffOptions };

    Object.entries(all).forEach((c) => {
        vscode.commands.executeCommand(
            "setContext",
            "perforce.currentFile." + c[0],
            c[1]
        );
    });
}

import { Display, ActiveStatusEvent, ActiveEditorStatus } from "./Display";
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
        isDiffable: false
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

function setContextVars(event: ActiveStatusEvent) {
    const isDiffable =
        event.status === ActiveEditorStatus.NOT_OPEN ||
        event.status === ActiveEditorStatus.OPEN ||
        event.file.scheme === "perforce" ||
        !!PerforceUri.decodeUriQuery(event.file.query).leftUri;

    fileContext = {
        status: event.status.toString(),
        depotPath: event.details?.depotPath ?? "",
        revision: event.details?.revision ?? "",
        changelist: event.details?.chnum ?? "",
        operation: event.details?.operation ?? "",
        filetype: event.details?.filetype ?? "",
        message: event.details?.message ?? "",
        isDiffable
    };

    Object.entries(fileContext).forEach(c => {
        vscode.commands.executeCommand(
            "setContext",
            "perforce.currentFile." + c[0],
            c[1]
        );
    });
}

function clearContextVars(file?: vscode.Uri) {
    fileContext = makeDefault();

    fileContext.isDiffable =
        !!file &&
        (file.scheme === "perforce" || !!PerforceUri.decodeUriQuery(file.query).leftUri);

    Object.entries(fileContext).forEach(c => {
        vscode.commands.executeCommand(
            "setContext",
            "perforce.currentFile." + c[0],
            c[1]
        );
    });

    vscode.commands.executeCommand("setContext", "perforce.currentFile.status", "");
}

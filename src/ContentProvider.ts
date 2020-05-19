import {
    window,
    workspace,
    Uri,
    Disposable,
    Event,
    EventEmitter,
    FileSystemProvider,
    FileChangeEvent,
    FileType,
    FileSystemError,
    FileChangeType,
} from "vscode";
import { Display } from "./Display";
import * as PerforceUri from "./PerforceUri";
import { runPerforceCommand, pathsToArgs } from "./api/CommandUtils";
import { isTruthy } from "./TsUtils";
import { TextEncoder } from "util";

export class PerforceFileSystemProvider implements FileSystemProvider, Disposable {
    private _onDidChangeFileEmitter = new EventEmitter<FileChangeEvent[]>();
    constructor() {
        this.disposables.push(
            workspace.registerFileSystemProvider("perforce", this, {
                isReadonly: true,
                isCaseSensitive: true,
            })
        );
    }
    private disposables: Disposable[] = [];
    dispose(): void {
        this.disposables.forEach((d) => d.dispose());
    }

    get onDidChangeFile() {
        return this._onDidChangeFileEmitter.event;
    }

    watch(_uri: Uri, _options: { recursive: boolean; excludes: string[] }): Disposable {
        return {
            dispose: () => {
                /**/
            },
        };
    }
    stat(_uri: Uri): import("vscode").FileStat | Thenable<import("vscode").FileStat> {
        const now = new Date().getTime();
        return { type: FileType.File, ctime: now, mtime: now, size: 0 };
    }
    readDirectory(_uri: Uri): [string, FileType][] {
        throw FileSystemError.NoPermissions();
    }
    createDirectory(_uri: Uri): void | Thenable<void> {
        throw FileSystemError.NoPermissions();
    }
    async readFile(uri: Uri) {
        const content = await this.provideTextDocumentContent(uri);
        return new TextEncoder().encode(content);
    }
    writeFile(
        _uri: Uri,
        _content: Uint8Array,
        _options: { create: boolean; overwrite: boolean }
    ): void | Thenable<void> {
        throw FileSystemError.NoPermissions();
    }
    delete(_uri: Uri, _options: { recursive: boolean }): void | Thenable<void> {
        throw FileSystemError.NoPermissions();
    }
    rename(
        _oldUri: Uri,
        _newUri: Uri,
        _options: { overwrite: boolean }
    ): void | Thenable<void> {
        throw FileSystemError.NoPermissions();
    }

    public requestUpdatedDocument(uri: Uri) {
        this._onDidChangeFileEmitter.fire([{ type: FileChangeType.Changed, uri: uri }]);
    }

    private getResourceForUri(uri: Uri): Uri | undefined {
        if (PerforceUri.isUsableForWorkspace(uri)) {
            return uri;
        }
        // just for printing the output of a command that doesn't relate to a specific file
        if (window.activeTextEditor && !window.activeTextEditor.document.isUntitled) {
            return window.activeTextEditor.document.uri;
        }
        return workspace.workspaceFolders?.[0].uri;
    }

    public async provideTextDocumentContent(uri: Uri): Promise<string> {
        if (uri.path === "EMPTY") {
            return "";
        }

        const allArgs = PerforceUri.decodeUriQuery(uri.query ?? "");
        const args = ((allArgs["p4Args"] as string) ?? "-q").split(" ");
        const command = (allArgs["command"] as string) ?? "print";

        const resource = this.getResourceForUri(uri);

        if (!resource) {
            Display.channel.appendLine(
                `Can't find proper workspace to provide content for ${uri}`
            );
            throw new Error(`Can't find proper workspace for command ${command} `);
        }

        // TODO - don't export this stuff from the API,
        // change the uri scheme so that it's not just running arbitrary commands
        const fileArgs = uri.fsPath ? pathsToArgs([uri]).filter(isTruthy) : [];
        const allP4Args = args.concat(fileArgs);

        return runPerforceCommand(resource, command, allP4Args, { hideStdErr: true });
    }
}

export class PerforceContentProvider {
    private onDidChangeEmitter = new EventEmitter<Uri>();

    get onDidChange(): Event<Uri> {
        return this.onDidChangeEmitter.event;
    }

    private disposables: Disposable[] = [];
    dispose(): void {
        this.disposables.forEach((d) => d.dispose());
    }

    constructor() {
        this.disposables.push(
            workspace.registerTextDocumentContentProvider("perforce", this)
        );
    }

    public requestUpdatedDocument(uri: Uri) {
        this.onDidChangeEmitter.fire(uri);
    }

    private getResourceForUri(uri: Uri): Uri | undefined {
        if (PerforceUri.isUsableForWorkspace(uri)) {
            return uri;
        }
        // just for printing the output of a command that doesn't relate to a specific file
        if (window.activeTextEditor && !window.activeTextEditor.document.isUntitled) {
            return window.activeTextEditor.document.uri;
        }
        return workspace.workspaceFolders?.[0].uri;
    }

    public async provideTextDocumentContent(uri: Uri): Promise<string> {
        if (uri.path === "EMPTY") {
            return "";
        }

        const allArgs = PerforceUri.decodeUriQuery(uri.query ?? "");
        const args = ((allArgs["p4Args"] as string) ?? "-q").split(" ");
        const command = (allArgs["command"] as string) ?? "print";

        const resource = this.getResourceForUri(uri);

        if (!resource) {
            Display.channel.appendLine(
                `Can't find proper workspace to provide content for ${uri}`
            );
            throw new Error(`Can't find proper workspace for command ${command} `);
        }

        // TODO - don't export this stuff from the API,
        // change the uri scheme so that it's not just running arbitrary commands
        const fileArgs = uri.fsPath ? pathsToArgs([uri]).filter(isTruthy) : [];
        const allP4Args = args.concat(fileArgs);

        return runPerforceCommand(resource, command, allP4Args, { hideStdErr: true });
    }
}

let _perforceContentProvider: PerforceFileSystemProvider;
export function perforceContentProvider() {
    if (!_perforceContentProvider) {
        _perforceContentProvider = new PerforceFileSystemProvider();
    }
    return _perforceContentProvider;
}

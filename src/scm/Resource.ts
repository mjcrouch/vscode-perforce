import {
    Command,
    SourceControlResourceState,
    SourceControlResourceDecorations,
    Uri,
    workspace,
} from "vscode";
import { DecorationProvider } from "./DecorationProvider";
import { GetStatuses, Status } from "./Status";
import { IFileType, GetFileType } from "./FileTypes";
import { Model, FstatInfo } from "./Model";
import * as PerforceUri from "../PerforceUri";

/**
 * An SCM resource represents a state of an underlying workspace resource
 * within a certain SCM provider state.
 *
 * For example, consider file A to be modified. An SCM resource which would
 * represent such state could have the following properties:
 *
 *   - `uri = 'git:workingtree/A'`
 *   - `sourceUri = 'file:A'`
 */
export class Resource implements SourceControlResourceState {
    private _statuses: Status[];
    private _headType: IFileType;
    private _resourceUri: Uri;
    private _openUri: Uri;
    private _fromFile?: Uri;
    private _fromEndRev?: string;
    private _isUnresolved: boolean;
    private _isReresolvable: boolean;

    /**
     * The working revision of the file if open (it should be)
     *
     * This is normally the same as the have revision, but a shelved file
     * might have a different working revision
     */
    private _workingRevision: string;

    /**
     * URI is always a depot path stored as a URI, without a revision
     * (depot paths are not really URIs, but it is close enough)
     *
     * You **must not** use fsPath on this URI to get a depot path - this does not work on windows.
     * Use the `depotPath` property instead.
     */
    get uri(): Uri {
        return this._uri;
    }

    /**
     * The URI to use to open this resource. For example a shelved file including the changelist or label
     *
     */
    get openUri() {
        return this._openUri;
    }
    /**
     * Resource URI *should* be the underlying file, but for shelved files, a depot path is used.
     * This is used for display in the SCM provider - so the depot path does not include a revision
     *
     * **DO NOT USE** this function - so we are free to change the display without impacting other areas.
     * Use `actionUriNoRev` instead
     *
     * this keeps them together in the workspace tree, and for some operations there may not be a matching file in the workspace
     */
    get resourceUri(): Uri {
        return this._resourceUri;
    }

    /**
     * The file to use for performing perforce actions that don't require a revision,
     * could be depot or local file
     *
     * Currently, resource URI has no rev, but this should be used instead of
     * resource URI for clarity and so we can change the display in future
     */
    get actionUriNoRev(): Uri {
        return this._resourceUri;
    }

    get basenameWithoutRev(): string {
        return PerforceUri.basenameWithoutRev(this.uri);
    }

    get decorations(): SourceControlResourceDecorations {
        return DecorationProvider.getDecorations(
            this._statuses,
            this._isShelved,
            this._isUnresolved
        );
    }
    /**
     * The underlying URI is always the workspace path, where it is known, or undefined otherwise
     */
    get underlyingUri(): Uri | undefined {
        return this._underlyingUri;
    }
    /**
     * A string representation of the depot path - this is needed because, on windows, the fsPath turns into backslashes
     */
    get depotPath(): string {
        return PerforceUri.getDepotPathFromDepotUri(this._uri);
    }
    /**
     * The base file from which this file is pending integration - a depot path as a URI, including revision
     *
     * You **must not** use fsPath on this URI to get a depot path - this does not work on windows.
     * Use `Utils.getDepotPathFromDepotUri` instead
     */
    get fromFile(): Uri | undefined {
        return this._fromFile;
    }

    get fromEndRev(): string | undefined {
        return this._fromEndRev;
    }

    get status(): Status {
        if (this._statuses.length > 0) {
            return this._statuses[0];
        }
        return Status.UNKNOWN;
    }

    get command(): Command {
        const command = workspace.getConfiguration("perforce").get("scmFileChanges")
            ? "perforce.openResource"
            : "perforce.openFile";
        return {
            title: "Open",
            command,
            arguments: [this],
        };
    }

    get change(): string {
        return this._change;
    }

    get workingRevision(): string {
        return this._workingRevision;
    }

    get isUnresolved() {
        return this._isUnresolved;
    }

    get isReresolvable() {
        return this._isReresolvable;
    }

    constructor(
        public model: Model,
        private _uri: Uri,
        private _underlyingUri: Uri | undefined,
        private _change: string,
        private _isShelved: boolean,
        action: string,
        fstatInfo: FstatInfo,
        headType?: string
    ) {
        this._statuses = GetStatuses(action);
        this._workingRevision = fstatInfo["workRev"] ?? fstatInfo["haveRev"] ?? "have"; // (files opened for branch probably have a workRev but no haveRev)

        if (this._isShelved) {
            // force a depot-like path as the resource URI, to sort them together in the tree
            this._resourceUri = PerforceUri.fromUri(_uri);
            this._openUri = PerforceUri.fromUriWithRevision(_uri, "@=" + this.change);
            this._isUnresolved = false;
            this._isReresolvable = false;
        } else {
            if (!_underlyingUri) {
                throw new Error(
                    "Files in the local workspace must have an underlying URI"
                );
            }
            this._resourceUri = _underlyingUri;
            this._openUri = _underlyingUri;
            this._isUnresolved = !!fstatInfo["unresolved"];
            this._isReresolvable = !!fstatInfo["reresolvable"];
            // TODO - do we need the one with the working revision - can't use a perforce: scheme here as it should be a local file
            //PerforceUri.fromUriWithRevision(_underlyingUri, this._workingRevision);
        }
        this._fromEndRev = fstatInfo["resolveEndFromRev0"];
        if (fstatInfo["resolveFromFile0"]) {
            this._fromFile = PerforceUri.fromDepotPath(
                this._underlyingUri ?? model.workspaceUri,
                fstatInfo["resolveFromFile0"],
                this._fromEndRev
            );
        }
        this._headType = GetFileType(headType);
    }

    get isShelved(): boolean {
        return this._isShelved;
    }

    get FileType(): IFileType {
        return this._headType;
    }
}

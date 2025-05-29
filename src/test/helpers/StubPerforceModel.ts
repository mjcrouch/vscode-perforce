import * as sinon from "sinon";
import * as vscode from "vscode";
import * as p4 from "../../api/PerforceApi";

import {
    ChangeInfo,
    ChangeSpec,
    FixedJob,
    FstatInfo,
    isUri,
    PerforceFile,
} from "../../api/CommonTypes";
import { Status } from "../../scm/Status";
import { PerforceService } from "../../PerforceService";
import { getStatusText } from "./testUtils";
import * as PerforceUri from "../../PerforceUri";
import { parseDate, isTruthy } from "../../TsUtils";

type PerforceResponseCallback = (
    err: Error | null,
    stdout: string,
    stderr: string
) => void;

export interface StubJob {
    name: string;
    description: string[];
}

export interface StubChangelist {
    chnum: string;
    description: string;
    submitted?: boolean;
    files: StubFile[];
    shelvedFiles?: StubFile[];
    jobs?: StubJob[];
}

export interface StubFile {
    localFile: vscode.Uri;
    suppressFstatClientFile?: boolean;
    depotPath: string;
    depotRevision: number;
    operation: Status;
    fileType?: string;
    resolveFromDepotPath?: string;
    resolveEndFromRev?: number;
}

export function stubExecute() {
    return sinon.stub(PerforceService, "execute").callsFake(executeStub);
}

function executeStub(
    _resource: vscode.Uri,
    command: string,
    responseCallback: PerforceResponseCallback,
    _args?: string[],
    _input?: string
) {
    setImmediate(() => {
        responseCallback(null, command, "");
    });
}

function makeDefaultInfo(resource: vscode.Uri) {
    const ret = new Map<string, string>();
    ret.set("User name", "user");
    ret.set("Client name", "cli");
    ret.set("Client root", resource.fsPath);
    ret.set("Current directory", resource.fsPath);
    return Promise.resolve(ret);
}

export class StubPerforceModel {
    public changelists: StubChangelist[];

    public isLoggedIn: sinon.SinonStub<any>;
    public deleteChangelist: sinon.SinonStub<any>;
    public fixJob: sinon.SinonStub<any>;
    public getChangeSpec: sinon.SinonStub<any>;
    public getChangelists: sinon.SinonStub<any>;
    public getFixedJobs: sinon.SinonStub<any>;
    public getFstatInfoMapped: sinon.SinonStub<any>;
    public getFstatInfo: sinon.SinonStub<any>;
    public getInfo: sinon.SinonStub<any>;
    public getOpenedFiles: sinon.SinonStub<any>;
    public getShelvedFiles: sinon.SinonStub<any>;
    public haveFile: sinon.SinonStub<any>;
    public have: sinon.SinonStub<any>;
    public reopenFiles: sinon.SinonStub<any>;
    public revert: sinon.SinonStub<any>;
    public shelve: sinon.SinonStub<any>;
    public submitChangelist: sinon.SinonStub<any>;
    public sync: sinon.SinonStub<any>;
    public unshelve: sinon.SinonStub<any>;
    public inputChangeSpec: sinon.SinonStub<any>;
    public del: sinon.SinonStub<any>;
    public move: sinon.SinonStub<any>;
    public edit: sinon.SinonStub<any>;
    public editIgnoringStdErr: sinon.SinonStub<any>;

    constructor() {
        this.changelists = [];

        this.isLoggedIn = sinon.stub(p4, "isLoggedIn").resolves(true);
        this.deleteChangelist = sinon
            .stub(p4, "deleteChangelist")
            .resolves("changelist deleted");
        this.fixJob = sinon.stub(p4, "fixJob").resolves("job fixed");
        this.getChangeSpec = sinon
            .stub(p4, "getChangeSpec")
            .callsFake(this.resolveChangeSpec.bind(this));
        this.getChangelists = sinon
            .stub(p4, "getChangelists")
            .callsFake(this.resolveChangelists.bind(this));
        this.getFixedJobs = sinon
            .stub(p4, "getFixedJobs")
            .callsFake(this.resolveFixedJobs.bind(this));
        this.getFstatInfoMapped = sinon
            .stub(p4, "getFstatInfoMapped")
            .callsFake(this.fstatFiles.bind(this));
        this.getFstatInfo = sinon
            .stub(p4, "getFstatInfo")
            .callsFake(this.resolveFstat.bind(this));
        this.getInfo = sinon.stub(p4, "getInfo").callsFake(makeDefaultInfo);
        this.getOpenedFiles = sinon
            .stub(p4, "getOpenedFiles")
            .callsFake(this.resolveOpenFiles.bind(this));
        this.getShelvedFiles = sinon
            .stub(p4, "getShelvedFiles")
            .callsFake(this.resolveShelvedFiles.bind(this));
        this.haveFile = sinon.stub(p4, "haveFile").resolves(true);
        this.have = sinon.stub(p4, "have").callsFake(this.resolveHave.bind(this));
        this.reopenFiles = sinon.stub(p4, "reopenFiles").resolves("reopened");
        this.revert = sinon.stub(p4, "revert").resolves("reverted");
        this.shelve = sinon.stub(p4, "shelve").resolves("shelved");
        this.submitChangelist = sinon.stub(p4, "submitChangelist").resolves({
            rawOutput: "submitting...\n change 250 submitted",
            chnum: "250",
        });
        this.sync = sinon.stub(p4, "sync").resolves("synced");
        this.unshelve = sinon.stub(p4, "unshelve").resolves({
            files: [{ depotPath: "//depot/dummy", operation: "edit" }],
            warnings: [],
        });
        this.inputChangeSpec = sinon
            .stub(p4, "inputChangeSpec")
            .resolves({ chnum: "99", rawOutput: "Change 99 created" });
        this.del = sinon.stub(p4, "del").resolves("Files deleted");
        this.move = sinon.stub(p4, "move").resolves("File moved");
        this.editIgnoringStdErr = sinon
            .stub(p4.edit, "ignoringAndHidingStdErr")
            .resolves("File edited");
        this.edit = sinon.stub(p4, "edit").resolves("File edited");
    }

    resolveOpenFiles(
        _resource: vscode.Uri,
        options: p4.OpenedFileOptions
    ): Promise<p4.OpenedFile[]> {
        return Promise.resolve(
            this.changelists
                .filter((cl) => (options.chnum ? cl.chnum === options.chnum : true))
                .flatMap((cl) =>
                    cl.files.map<p4.OpenedFile>((file) => {
                        return {
                            depotPath: file.depotPath,
                            revision: file.depotRevision.toString(),
                            chnum: cl.chnum,
                            filetype: file.fileType ?? "text",
                            message:
                                file.depotPath +
                                " opened for " +
                                getStatusText(file.operation),
                            operation: getStatusText(file.operation),
                        };
                    })
                )
        );
    }

    resolveChangelists(
        _resource: vscode.Uri,
        options: p4.ChangesOptions
    ): Promise<ChangeInfo[]> {
        // filter submitted and default changelists
        // if status is shelved, include changelists with shelved files only
        return Promise.resolve(
            this.changelists
                .filter(
                    (cl) =>
                        !cl.submitted &&
                        cl.chnum !== "default" &&
                        (options.status !== p4.ChangelistStatus.SHELVED ||
                            (cl.shelvedFiles !== undefined &&
                                options.status === p4.ChangelistStatus.SHELVED))
                )
                .map<ChangeInfo>((cl) => {
                    return {
                        chnum: cl.chnum,
                        date: parseDate("01/01/2020"),
                        client: "cli",
                        user: "user",
                        description: cl.description.split("\n"),
                        isPending: true,
                    };
                })
        );
    }

    findFile(uri: vscode.Uri): [StubChangelist, StubFile] | undefined {
        const change = this.changelists.find((ch) =>
            ch.files.some((f) => f.localFile.fsPath === uri.fsPath)
        );
        const file = change?.files.find((f) => f.localFile.fsPath === uri.fsPath);
        return change && file ? [change, file] : undefined;
    }

    resolveHave(
        resource: vscode.Uri,
        options: p4.HaveFileOptions
    ): Promise<p4.HaveFile | undefined> {
        if (!isUri(options.file)) {
            throw new Error("Doesn't support non-uri types yet");
        }
        const details = this.findFile(options.file);
        if (!details) {
            return Promise.resolve(undefined);
        }
        const [, file] = details;
        return Promise.resolve({
            depotPath: file.depotPath,
            revision: file.depotRevision.toString(),
            depotUri: PerforceUri.fromDepotPath(
                resource,
                file.depotPath,
                file.depotRevision.toString()
            ),
            localUri: file.localFile,
        });
    }

    resolveFixedJobs(
        _resource: vscode.Uri,
        options: p4.GetFixedJobsOptions
    ): Promise<FixedJob[]> {
        const cl = this.changelists.find((cl) => cl.chnum === options.chnum);
        if (!cl) {
            return Promise.reject("Changelist does not exist");
        }
        return Promise.resolve(
            cl.jobs?.map<FixedJob>((job) => {
                return { description: job.description, id: job.name };
            }) ?? []
        );
    }

    resolveShelvedFiles(
        _resource: vscode.Uri,
        options: p4.GetShelvedOptions
    ): Promise<p4.ShelvedChangeInfo[]> {
        return Promise.resolve(
            this.changelists
                .filter((cl) => options.chnums.includes(cl.chnum))
                .map((cl) => {
                    return {
                        chnum: parseInt(cl.chnum),
                        paths: cl.shelvedFiles?.map((s) => s.depotPath),
                    };
                })
                .filter((cl): cl is p4.ShelvedChangeInfo => cl.paths !== undefined)
        );
    }

    fstatFile(
        depotPath: PerforceFile,
        chnum?: string,
        shelved?: boolean
    ): FstatInfo | undefined {
        const cl = this.changelists.find((c) =>
            chnum
                ? c.chnum === chnum
                : c.files.some((file) => file.depotPath === depotPath)
        );
        const file = shelved
            ? cl?.shelvedFiles?.find((file) => file.depotPath === depotPath)
            : cl?.files.find((file) => file.depotPath === depotPath);

        if (file) {
            return {
                depotFile: depotPath,
                clientFile: file.suppressFstatClientFile
                    ? undefined
                    : file.localFile.fsPath,
                isMapped: "true",
                haveRev: file.depotRevision.toString(),
                headType: file.fileType ?? "text",
                action: getStatusText(file.operation),
                workRev: file.depotRevision?.toString(),
                change: cl?.chnum,
                resolveFromFile0: file.resolveFromDepotPath,
                resolveEndFromRev0: file.resolveEndFromRev?.toString(),
            } as FstatInfo;
        }
    }

    fstatFiles(
        _resource: vscode.Uri,
        options: p4.FstatOptions
    ): Promise<(FstatInfo | undefined)[]> {
        const files = options.depotPaths.map((path) =>
            this.fstatFile(path, options.chnum, options.limitToShelved)
        );
        return Promise.resolve(files);
        //return Promise.reject("implement me");
    }

    resolveFstat(_resource: vscode.Uri, options: p4.FstatOptions): Promise<FstatInfo[]> {
        const cl = this.changelists.find((c) =>
            options.chnum === c.chnum ? c : undefined
        );
        // If this is an fstat command a client file specifier, then use the change's
        // shelved file or file names respectively.
        const fileList = options.depotPaths.includes("//cli/...")
            ? (
                  (options.limitToShelved ? cl?.shelvedFiles : cl?.files) ??
                  ([] as StubFile[])
              ).map((f) => f.depotPath)
            : options.depotPaths;
        const files = fileList
            .map((path) => this.fstatFile(path, options.chnum, options.limitToShelved))
            .filter(isTruthy);
        return Promise.resolve(files);
    }

    resolveChangeSpec(
        _resource: vscode.Uri,
        options: p4.ChangeSpecOptions
    ): Promise<ChangeSpec> {
        if (options.existingChangelist) {
            const cl = this.changelists.find(
                (cl) => cl.chnum === options.existingChangelist
            );
            if (!cl) {
                return Promise.reject("No such changelist " + options.existingChangelist);
            }
            return Promise.resolve<ChangeSpec>({
                change: options.existingChangelist,
                description: cl.description,
                files: cl.files.map((file) => {
                    return {
                        action: getStatusText(file.operation),
                        depotPath: file.depotPath,
                    };
                }),
                rawFields: [{ name: "A field", value: ["don't know"] }],
            });
        }
        const cl = this.changelists.find((cl) => cl.chnum === "default");
        return Promise.resolve<ChangeSpec>({
            description: "<Enter description>",
            files: cl?.files.map((file) => {
                return {
                    action: getStatusText(file.operation),
                    depotPath: file.depotPath,
                };
            }),
            rawFields: [{ name: "A field", value: ["don't know"] }],
        });
    }
}

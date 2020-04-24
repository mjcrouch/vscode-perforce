import * as vscode from "vscode";

import * as PerforceUri from "../PerforceUri";
import * as p4 from "../api/PerforceApi";

import * as qp from "./QuickPickProvider";
import { Display } from "../Display";
import { DescribedChangelist } from "../api/PerforceApi";
import { showQuickPickForFile } from "./FileQuickPick";
import { toReadableDateTime } from "../DateFormatter";
import { configAccessor } from "../ConfigService";
import { focusChangelist } from "../search/ChangelistTreeView";
import { PerforceSCMProvider } from "../ScmProvider";

const nbsp = "\xa0";

export const changeQuickPickProvider: qp.ActionableQuickPickProvider = {
    provideActions: async (
        resourceOrStr: vscode.Uri | string,
        chnum: string
    ): Promise<qp.ActionableQuickPick> => {
        const resource = qp.asUri(resourceOrStr);
        const changes = await p4.describe(resource, {
            chnums: [chnum],
            omitDiffs: true,
        });

        if (changes.length < 1) {
            Display.showImportantError("Unable to find change details");
            throw new Error("Unable to find change details");
        }

        const change = changes[0];

        const shelvedChanges = change.isPending
            ? await p4.describe(resource, {
                  omitDiffs: true,
                  shelved: true,
                  chnums: [chnum],
              })
            : [];

        const shelvedChange = shelvedChanges[0];
        const actions = makeFocusPick(resource, change).concat(
            makeSwarmPick(change),
            makeClipboardPicks(resource, change),
            makeUnshelvePicks(resource, shelvedChange),
            makeJobPicks(resource, change),
            makeFilePicks(resource, change),
            makeShelvedFilePicks(resource, shelvedChange)
        );

        return {
            items: actions,
            placeHolder:
                "Change " +
                chnum +
                " by " +
                change.user +
                " on " +
                toReadableDateTime(change.date) +
                " : " +
                change.description.join(" "),
        };
    },
};

async function unshelveAndRefresh(resource: vscode.Uri, options: p4.UnshelveOptions) {
    try {
        const output = await p4.unshelve(resource, options);
        Display.showMessage("Changelist unshelved");
        if (output.warnings.length > 0) {
            Display.showImportantError(
                "The changelist was unshelved, but " +
                    output.warnings.length +
                    " file(s) need resolving"
            );
        }
    } catch (err) {}
    PerforceSCMProvider.RefreshAll();
}

export const unshelveChangeQuickPickProvider: qp.ActionableQuickPickProvider = {
    provideActions: async (
        resourceOrStr: vscode.Uri | string,
        chnum: string,
        clobber: boolean = true,
        branchMapping?: string
    ): Promise<qp.ActionableQuickPick> => {
        const resource = qp.asUri(resourceOrStr);
        const defaultChangelistAction: qp.ActionableQuickPickItem = {
            label: "Default changelist",
            description:
                "Unshelve into the default changelist, or the current changelist if already unshelved",
            performAction: () =>
                unshelveAndRefresh(resource, {
                    shelvedChnum: chnum,
                    branchMapping,
                    force: clobber,
                }),
        };
        const newChangelistAction: qp.ActionableQuickPickItem = {
            label: "New changelist",
            description: "Unshelve into a new changelist",
            performAction: async () => {
                const spec = await p4.getChangeSpec(resource, {});
                spec.description = "Unshelved from change #" + chnum;
                spec.files = [];
                const newChange = await p4.inputChangeSpec(resource, { spec });
                await unshelveAndRefresh(resource, {
                    shelvedChnum: chnum,
                    toChnum: newChange.chnum,
                    branchMapping,
                    force: clobber,
                });
            },
        };
        const changelistActions = await getUnshelveChangelistPicks(
            resource,
            chnum,
            clobber,
            branchMapping
        );
        return {
            items: [defaultChangelistAction, newChangelistAction, ...changelistActions],
            excludeFromHistory: true,
            placeHolder:
                "Unshelve changelist " +
                chnum +
                (branchMapping ? " through branch " + branchMapping : "") +
                (clobber ? " (WILL CLOBBER WRITABLE FILES)" : ""),
        };
    },
};

async function getUnshelveChangelistPicks(
    resource: vscode.Uri,
    chnum: string,
    clobber: boolean,
    branchMapping?: string
) {
    const info = await p4.getInfo(resource, {});
    const user = info.get("User name");

    if (!user) {
        return [];
    }

    const changelists = await p4.getChangelists(resource, {
        user,
        status: p4.ChangelistStatus.PENDING,
    });
    return changelists.map<qp.ActionableQuickPickItem>((c) => {
        return {
            label: c.chnum,
            description: c.description.join(" "),
            performAction: () =>
                unshelveAndRefresh(resource, {
                    shelvedChnum: chnum,
                    toChnum: c.chnum,
                    branchMapping,
                    force: clobber,
                }),
        };
    });
}

export async function showUnshelveQuickPick(
    resource: vscode.Uri,
    chnum: string,
    branchMapping?: string
) {
    return qp.showQuickPick("unshelveChange", resource, chnum, true, branchMapping);
}

export async function showQuickPickForChangelist(resource: vscode.Uri, chnum: string) {
    await qp.showQuickPick("change", resource, chnum);
}

export function getOperationIcon(operation: string) {
    switch (operation) {
        case "add":
            return "diff-added";
        case "delete":
        case "move/delete":
        case "purge":
            return "diff-removed";
        case "move/add":
        case "integrate":
        case "branch":
            return "diff-renamed";
        default:
            return "diff-modified";
    }
}

function makeFocusPick(
    resource: vscode.Uri,
    change: DescribedChangelist
): qp.ActionableQuickPickItem[] {
    return [
        {
            label: "$(multiple-windows) Focus in changelist search view",
            performAction: () => {
                focusChangelist(resource, change);
            },
        },
    ];
}

function makeSwarmPick(change: DescribedChangelist): qp.ActionableQuickPickItem[] {
    const swarmAddr = configAccessor.getSwarmLink(change.chnum);
    if (!swarmAddr) {
        return [];
    }

    try {
        const uri = vscode.Uri.parse(swarmAddr, true);
        return [
            {
                label: "$(eye) Open in review tool",
                description: "$(link-external) " + uri.toString(),
                performAction: () => {
                    vscode.env.openExternal(uri);
                },
            },
        ];
    } catch (err) {
        Display.showImportantError(
            "Could not parse swarm link " +
                swarmAddr +
                " - make sure you have included the protocol, e.g. https://"
        );
        return [];
    }
}

function makeClipboardPicks(
    _uri: vscode.Uri,
    change: DescribedChangelist
): qp.ActionableQuickPickItem[] {
    return [
        {
            label: "$(clippy) Copy change number to clipboard",
            description: change.chnum,
            performAction: () => {
                vscode.env.clipboard.writeText(change.chnum);
            },
        },
        {
            label: "$(clippy) Copy user to clipboard",
            description: change.user,
            performAction: () => {
                vscode.env.clipboard.writeText(change.user);
            },
        },
        {
            label: "$(clippy) Copy change description to clipboard",
            description: change.description.join(" ").slice(0, 32),
            performAction: () => {
                vscode.env.clipboard.writeText(change.description.join("\n"));
            },
        },
    ];
}

function makeFilePicks(
    uri: vscode.Uri,
    change: DescribedChangelist
): qp.ActionableQuickPickItem[] {
    return [
        {
            label: "Changed files: " + change.affectedFiles.length,
        },
    ].concat(
        change.affectedFiles.map<qp.ActionableQuickPickItem>((file) => {
            return {
                label:
                    nbsp.repeat(3) +
                    "$(" +
                    getOperationIcon(file.operation) +
                    ")" +
                    " " +
                    file.depotPath +
                    "#" +
                    file.revision,
                performAction: () => {
                    const thisUri = PerforceUri.fromDepotPath(
                        PerforceUri.getUsableWorkspace(uri) ?? uri,
                        file.depotPath,
                        file.revision
                    );
                    showQuickPickForFile(thisUri);
                },
            };
        })
    );
}

function makeUnshelvePicks(
    uri: vscode.Uri,
    change?: DescribedChangelist
): qp.ActionableQuickPickItem[] {
    if (!change || change.shelvedFiles.length < 1) {
        return [];
    }
    return [
        {
            label: "$(cloud-download) Unshelve changelist...",
            description: "Unshelve into a selected changelist",
            performAction: () => {
                showUnshelveQuickPick(uri, change.chnum);
            },
        },
        {
            label: "$(cloud-download) Unshelve via branch mapping...",
            description: "Unshelve, mapping through a branch spec",
            performAction: async (reopen) => {
                const branch = await vscode.window.showInputBox({
                    prompt:
                        "Enter branch name to unshelve changelist " +
                        change.chnum +
                        " through",
                    ignoreFocusOut: true,
                });
                if (branch === undefined) {
                    reopen();
                } else {
                    showUnshelveQuickPick(uri, change.chnum, branch);
                }
            },
        },
    ];
}

function makeShelvedFilePicks(
    uri: vscode.Uri,
    change?: DescribedChangelist
): qp.ActionableQuickPickItem[] {
    if (!change || change.shelvedFiles.length < 1) {
        return [];
    }
    return [
        {
            label: "Shelved files: " + change.shelvedFiles.length,
        },
    ].concat(
        change.shelvedFiles.map<qp.ActionableQuickPickItem>((file) => {
            return {
                label:
                    nbsp.repeat(3) +
                    "$(" +
                    getOperationIcon(file.operation) +
                    ")" +
                    " " +
                    file.depotPath +
                    "#" +
                    file.revision,
                performAction: () => {
                    const thisUri = PerforceUri.fromDepotPath(
                        PerforceUri.getUsableWorkspace(uri) ?? uri,
                        file.depotPath,
                        file.revision
                    );
                    showQuickPickForFile(thisUri);
                },
            };
        })
    );
}

function makeJobPicks(
    uri: vscode.Uri,
    change: DescribedChangelist
): qp.ActionableQuickPickItem[] {
    return [
        {
            label: "Jobs fixed: " + change.fixedJobs.length,
        },
    ].concat(
        change.fixedJobs.map<qp.ActionableQuickPickItem>((job) => {
            return {
                label: nbsp.repeat(3) + "$(tools) " + job.id,
                description: job.description.join(" "),
            };
        })
    );
}

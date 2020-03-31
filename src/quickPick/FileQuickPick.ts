import * as vscode from "vscode";

import * as PerforceUri from "../PerforceUri";
import * as p4 from "../api/PerforceApi";
import * as DiffProvider from "../DiffProvider";
import { Display } from "../Display";
import { AnnotationProvider } from "../annotations/AnnotationProvider";
import { isTruthy } from "../TsUtils";
import * as Path from "path";

import * as ChangeQuickPick from "./ChangeQuickPick";

import * as qp from "./QuickPickProvider";

export const fileQuickPickProvider: qp.ActionableQuickPickProvider = {
    provideActions: async (uri: vscode.Uri, cached?: CachedOutput) => {
        const changes = await getChangeDetails(uri, cached);
        const actions = makeNextAndPrevPicks(uri, changes).concat(
            makeDiffPicks(uri, changes),
            makeChangelistPicks(uri, changes)
        );
        return {
            items: actions,
            placeHolder: makeRevisionSummary(changes.current)
        };
    }
};

export async function showQuickPickForFile(uri: vscode.Uri, cached?: CachedOutput) {
    await qp.showQuickPick("file", uri, cached);
}

export const fileRevisionQuickPickProvider: qp.ActionableQuickPickProvider = {
    provideActions: async (
        uri: vscode.Uri,
        includeIntegrations: boolean,
        cached?: CachedOutput
    ) => {
        const changes = await getChangeDetails(uri, cached);
        const actions = makeAllRevisionPicks(uri, changes, includeIntegrations);
        return {
            items: actions,
            excludeFromHistory: true,
            placeHolder:
                "Choose revision for " +
                changes.current.file +
                "#" +
                changes.current.revision
        };
    }
};

export async function showRevChooserForFile(uri: vscode.Uri, cached?: CachedOutput) {
    await qp.showQuickPick("filerev", uri, false, cached);
}

async function showRevChooserWithIntegrations(
    uri: vscode.Uri,
    includeIntegrations: boolean,
    cached?: CachedOutput
) {
    await qp.showQuickPick("filerev", uri, includeIntegrations, cached);
}

export const fileDiffQuickPickProvider: qp.ActionableQuickPickProvider = {
    provideActions: async (uri: vscode.Uri) => {
        const changes = await getChangeDetails(uri, undefined, true);
        const actions = makeDiffRevisionPicks(uri, changes);
        return {
            items: actions,
            excludeFromHistory: true,
            placeHolder:
                "Diff revision for " +
                changes.current.file +
                "#" +
                changes.current.revision
        };
    }
};

export async function showDiffChooserForFile(uri: vscode.Uri) {
    await qp.showQuickPick("filediff", uri);
}

type CachedOutput = {
    filelog: p4.FileLogItem[];
};

type ChangeDetails = {
    all: p4.FileLogItem[];
    current: p4.FileLogItem;
    currentIndex: number;
    next?: p4.FileLogItem;
    prev?: p4.FileLogItem;
    latest: p4.FileLogItem;
};

function makeRevisionSummary(change: p4.FileLogItem, shortName?: boolean) {
    return (
        (shortName ? Path.basename(change.file) : change.file) +
        "#" +
        change.revision +
        " " +
        change.operation +
        " by " +
        change.user +
        " : " +
        change.description.slice(0, 32)
    );
}

async function getChangeDetails(
    uri: vscode.Uri,
    cached?: CachedOutput,
    followBranches?: boolean
): Promise<ChangeDetails> {
    const rev = uri.fragment;
    if (!uri.fragment) {
        throw new Error("TODO - no revision");
    }
    const revNum = parseInt(rev);
    if (isNaN(revNum)) {
        throw new Error("TODO - not a revision");
        // TODO handle shelved files
    }

    const arg = PerforceUri.fromUriWithRevision(uri, ""); // need more history than this! `#${revNum},${revNum}`);
    // TODO pass this in again when navigating revisions to prevent having to get it every time
    const filelog =
        cached?.filelog ??
        (await p4.getFileHistory(uri, { file: arg, followBranches: followBranches }));

    if (filelog.length === 0) {
        // TODO
        throw new Error("TODO - no filelog info");
    }

    const currentIndex = filelog.findIndex(c => c.revision === uri.fragment);
    const current = filelog[currentIndex];
    const next = filelog[currentIndex - 1];
    const prev = filelog[currentIndex + 1];
    const latest = filelog[0];

    return { all: filelog, current, currentIndex, next, prev, latest };
}

function makeAllRevisionPicks(
    uri: vscode.Uri,
    changes: ChangeDetails,
    includeIntegrations: boolean
): qp.ActionableQuickPickItem[] {
    const revPicks = changes.all.flatMap(change => {
        const icon =
            change === changes.current ? "$(location)" : "$(debug-stackframe-dot)";
        const fromRev = includeIntegrations
            ? change.integrations.find(c => c.direction === p4.Direction.FROM)
            : undefined;
        return [
            {
                label: icon + " #" + change.revision,
                description:
                    change.operation +
                    " by " +
                    change.user +
                    " : " +
                    change.description.slice(0, 32),
                performAction: () => {
                    const revUri = PerforceUri.fromDepotPath(
                        PerforceUri.getUsableWorkspace(uri) ?? uri,
                        change.file,
                        change.revision
                    );
                    return showQuickPickForFile(revUri, { filelog: changes.all });
                }
            },
            fromRev
                ? {
                      label: "$(git-merge) " + fromRev.file + "#" + fromRev.endRev,
                      description: fromRev.operation,
                      performAction: () => {
                          const revUri = PerforceUri.fromDepotPath(
                              PerforceUri.getUsableWorkspace(uri) ?? uri,
                              fromRev.file,
                              fromRev.endRev
                          );
                          return showQuickPickForFile(revUri, { filelog: changes.all });
                      }
                  }
                : undefined
        ].filter(isTruthy);
    });
    return [
        {
            label: includeIntegrations
                ? "$(exclude) Hide integration source files"
                : "$(gear) Show integration source files",
            performAction: () => {
                return showRevChooserWithIntegrations(uri, !includeIntegrations, {
                    filelog: changes.all
                });
            }
        }
    ].concat(revPicks);
}

function makeDiffRevisionPicks(
    uri: vscode.Uri,
    changes: ChangeDetails
): qp.ActionableQuickPickItem[] {
    const currentUri = PerforceUri.fromDepotPath(
        PerforceUri.getUsableWorkspace(uri) ?? uri,
        changes.current.file,
        changes.current.revision
    );
    return changes.all.map((change, i) => {
        const prefix =
            change === changes.current
                ? "$(location) "
                : change.file === changes.current.file
                ? "$(debug-stackframe-dot) "
                : "$(git-merge) " + change.file;
        const isOldRev = i > changes.currentIndex;
        return {
            label: prefix + "#" + change.revision,
            description:
                change.operation +
                " by " +
                change.user +
                " : " +
                change.description.slice(0, 32),
            performAction: () => {
                const thisUri = PerforceUri.fromDepotPath(
                    PerforceUri.getUsableWorkspace(uri) ?? uri,
                    change.file,
                    change.revision
                );
                DiffProvider.diffFiles(
                    isOldRev ? thisUri : currentUri,
                    isOldRev ? currentUri : thisUri
                );
            }
        };
    });
}

function makeNextAndPrevPicks(
    uri: vscode.Uri,
    changes: ChangeDetails
): qp.ActionableQuickPickItem[] {
    const prev = changes.prev;
    const next = changes.next;
    const integFrom = changes.current.integrations.find(
        i => i.direction === p4.Direction.FROM
    );
    return [
        prev
            ? {
                  label: "$(arrow-small-left) Previous revision",
                  description: makeRevisionSummary(prev, true),
                  performAction: () => {
                      const prevUri = PerforceUri.fromDepotPath(
                          PerforceUri.getUsableWorkspace(uri) ?? uri,
                          prev.file,
                          prev.revision
                      );
                      return showQuickPickForFile(prevUri, { filelog: changes.all });
                  }
              }
            : {
                  label: "$(arrow-small-left) Previous revision",
                  description: "n/a",
                  performAction: () => {
                      return showQuickPickForFile(uri, { filelog: changes.all });
                  }
              },
        next
            ? {
                  label: "$(arrow-small-right) Next revision",
                  description: makeRevisionSummary(next, true),
                  performAction: () => {
                      const nextUri = PerforceUri.fromDepotPath(
                          PerforceUri.getUsableWorkspace(uri) ?? uri,
                          next.file,
                          next.revision
                      );
                      return showQuickPickForFile(nextUri, { filelog: changes.all });
                  }
              }
            : {
                  label: "$(arrow-small-right) Next revision",
                  description: "n/a",
                  performAction: () => {
                      return showQuickPickForFile(uri, { filelog: changes.all });
                  }
              },
        {
            label: "$(symbol-numeric) File history...",
            description: "Go to a specific revision",
            performAction: () => {
                showRevChooserForFile(uri, { filelog: changes.all });
            }
        },
        integFrom
            ? {
                  label: "$(git-merge) Go to integration source revision",
                  description:
                      integFrom.operation +
                      " from " +
                      integFrom.file +
                      "#" +
                      integFrom.endRev,
                  performAction: () => {
                      const integUri = PerforceUri.fromDepotPath(
                          PerforceUri.getUsableWorkspace(uri) ?? uri,
                          integFrom.file,
                          integFrom.endRev
                      );
                      return showQuickPickForFile(integUri);
                  }
              }
            : undefined,
        {
            label: "$(source-control) View integrations...",
            description: "See integrations including this revision",
            performAction: () => {
                Display.showMessage("TODO: implement p4 integrated");
            }
        }
    ].filter(isTruthy);
}

function makeDiffPicks(
    uri: vscode.Uri,
    changes: ChangeDetails
): qp.ActionableQuickPickItem[] {
    const prev = changes.prev;
    const latest = changes.latest;
    return [
        {
            label: "$(file) Show this revision",
            performAction: () => {
                vscode.window.showTextDocument(uri);
            }
        },
        {
            label: "$(list-ordered) Annotate",
            performAction: () => {
                // TODO SWARM HOST
                AnnotationProvider.annotate(uri);
            }
        },
        prev
            ? {
                  label: "$(diff) Diff against previous revision",
                  description: DiffProvider.diffTitleForDepotPaths(
                      prev.file,
                      prev.revision,
                      changes.current.file,
                      changes.current.revision
                  ),
                  performAction: () => DiffProvider.diffPreviousIgnoringLeftInfo(uri)
              }
            : undefined,
        latest !== changes.current
            ? {
                  label: "$(diff) Diff against latest revision",
                  description: DiffProvider.diffTitleForDepotPaths(
                      changes.current.file,
                      changes.current.revision,
                      latest.file,
                      latest.revision
                  ),
                  performAction: () =>
                      DiffProvider.diffFiles(
                          PerforceUri.fromDepotPath(
                              PerforceUri.getUsableWorkspace(uri) ?? uri,
                              changes.current.file,
                              changes.current.revision
                          ),
                          PerforceUri.fromDepotPath(
                              PerforceUri.getUsableWorkspace(uri) ?? uri,
                              latest.file,
                              latest.revision
                          )
                      )
              }
            : undefined,
        {
            label: "$(diff) Diff against workspace file",
            performAction: () => {
                // do this in the diff provider
                Display.showMessage("TODO - work out workspace file for a depot file");
            }
        },
        {
            label: "$(diff) Diff against...",
            description: "Choose another revision to diff against",
            performAction: () => {
                // do this in the diff provider
                showDiffChooserForFile(uri);
            }
        }
    ].filter(isTruthy);
}

function makeChangelistPicks(
    _uri: vscode.Uri,
    changes: ChangeDetails
): qp.ActionableQuickPickItem[] {
    return [
        {
            label: "$(list-flat) Go to changelist details",
            description: "Change " + changes.current.chnum,
            performAction: () =>
                ChangeQuickPick.showQuickPickForChangelist(changes.current.chnum)
        }
    ];
}

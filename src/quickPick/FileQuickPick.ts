import * as vscode from "vscode";

import * as PerforceUri from "../PerforceUri";
import * as p4 from "../api/PerforceApi";
import * as DiffProvider from "../DiffProvider";
import { Display } from "../Display";
import { AnnotationProvider } from "../annotations/AnnotationProvider";
import { isTruthy } from "../TsUtils";

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

type CachedOutput = {
    filelog: p4.FileLogItem[];
};

type ChangeDetails = {
    all: p4.FileLogItem[];
    current: p4.FileLogItem;
    next?: p4.FileLogItem;
    prev?: p4.FileLogItem;
    latest: p4.FileLogItem;
};

function makeRevisionSummary(change: p4.FileLogItem) {
    return (
        change.file +
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
    cached?: CachedOutput
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
    const filelog = cached?.filelog ?? (await p4.getFileHistory(uri, { file: arg }));

    if (filelog.length === 0) {
        // TODO
        throw new Error("TODO - no filelog info");
    }

    const currentIndex = filelog.findIndex(c => c.revision === uri.fragment);
    const current = filelog[currentIndex];
    const next = filelog[currentIndex - 1];
    const prev = filelog[currentIndex + 1];
    const latest = filelog[0];

    return { all: filelog, current, next, prev, latest };
}

export async function showQuickPickForFile(uri: vscode.Uri, cached?: CachedOutput) {
    await qp.showQuickPick("file", uri, cached);
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
                  description: makeRevisionSummary(prev),
                  performAction: () => {
                      const prevUri = PerforceUri.fromDepotPath(
                          PerforceUri.getUsableWorkspace(uri) ?? uri,
                          prev.file,
                          prev.revision
                      );
                      return showQuickPickForFile(prevUri, { filelog: changes.all });
                  }
              }
            : undefined,
        next
            ? {
                  label: "$(arrow-small-right) Next revision",
                  description: makeRevisionSummary(next),
                  performAction: () => {
                      const nextUri = PerforceUri.fromDepotPath(
                          PerforceUri.getUsableWorkspace(uri) ?? uri,
                          next.file,
                          next.revision
                      );
                      return showQuickPickForFile(nextUri, { filelog: changes.all });
                  }
              }
            : undefined,
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
            // TODO - from this file or including this revision?
            description: "See integrations from this file",
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
                Display.showMessage("TODO - get revision list");
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
            label: "$(list-flat) Show changelist details",
            description: "Change " + changes.current.chnum,
            performAction: () =>
                ChangeQuickPick.showQuickPickForChangelist(changes.current.chnum)
        }
    ];
}

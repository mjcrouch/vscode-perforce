import * as vscode from "vscode";
import * as p4 from "./api/PerforceApi";
import * as PerforceUri from "./PerforceUri";
import * as DiffProvider from "./DiffProvider";
import { showQuickPickForFile } from "./quickPick/FileQuickPick";
import { isTruthy } from "./TsUtils";
import { showQuickPickForChangelist } from "./quickPick/ChangeQuickPick";

interface PerforceTimelineItem extends vscode.TimelineItem {
    perforceUri: vscode.Uri;
    logItem: p4.FileLogItem;
    prevItem?: p4.FileLogItem;
    latestItem: p4.FileLogItem;
    localFile?: vscode.Uri;
}

type FileCache = {
    items: PerforceTimelineItem[];
    isFullSet: boolean;
};

class PerforceTimelineProvider implements vscode.TimelineProvider {
    private _cached = new Map<string, FileCache>();

    private getCachedItems(uri: vscode.Uri, isInitialCall: boolean) {
        const underlying = PerforceUri.isDepotUri(uri)
            ? PerforceUri.getDepotPathFromDepotUri(uri)
            : uri.fsPath;
        const cached = this._cached.get(underlying);
        if (!isInitialCall && !cached?.isFullSet) {
            // need more than we already have
            return undefined;
        }
        return cached;
    }

    private setCachedItems(
        uri: vscode.Uri,
        items: PerforceTimelineItem[],
        isFullSet: boolean
    ) {
        const underlying = PerforceUri.isDepotUri(uri)
            ? PerforceUri.getDepotPathFromDepotUri(uri)
            : uri.fsPath;
        this._cached.set(underlying, { items, isFullSet });
    }

    private async getLocalFile(uri: vscode.Uri) {
        if (!PerforceUri.isDepotUri(uri)) {
            return uri;
        }
        const have = await p4.have(uri, { file: uri });
        return have?.localUri;
    }

    private makeContext(item: PerforceTimelineItem) {
        const parts = [
            item.latestItem !== item.logItem ? "nl" : undefined,
            item.localFile ? "lf" : undefined,
        ].filter(isTruthy);

        return "p4:" + parts.join("-");
    }

    private makeTimelineItem(
        uri: vscode.Uri,
        localFile: vscode.Uri | undefined,
        log: p4.FileLogItem,
        latest: p4.FileLogItem,
        prev?: p4.FileLogItem,
        isOldFile?: boolean
    ) {
        const perforceUri = PerforceUri.fromDepotPath(uri, log.file, log.revision);

        const command: vscode.Command = {
            command: "perforce.timeline.diffPrevious",
            title: "Diff against previous",
            arguments: [],
        };

        const item: PerforceTimelineItem = {
            timestamp: log.date?.getTime() ?? 0,
            label: log.revision + ": " + log.description.split("\n")[0].slice(0, 64),
            iconPath: new vscode.ThemeIcon(isOldFile ? "git-merge" : "git-commit"),
            description: log.user,
            detail: log.file + "#" + log.revision + "\n--------\n\n" + log.description,
            id: log.chnum,
            perforceUri: perforceUri,
            logItem: log,
            prevItem: prev,
            latestItem: latest,
            localFile,
            contextValue: "p4",
            command,
        };
        command.arguments = [item];
        item.contextValue = this.makeContext(item);

        return item;
    }

    async getHistoryAndItems(uri: vscode.Uri, max?: number) {
        const filelog = await p4.getFileHistory(uri, {
            file: PerforceUri.fromUriWithRevision(uri, ""),
            followBranches: true,
            max,
        });

        const localFile = await this.getLocalFile(uri);

        const items = filelog.map<PerforceTimelineItem>((h, i, all) => {
            const isOldFile = h.file !== filelog[0].file;
            const prev = all[i + 1];
            return this.makeTimelineItem(uri, localFile, h, all[0], prev, isOldFile);
        });

        this.setCachedItems(uri, items, max === undefined);

        return items;
    }

    onDidChange?: vscode.Event<vscode.TimelineChangeEvent | undefined> | undefined;
    id: string = "perforce";
    label: string = "Perforce file revisions";
    async provideTimeline(
        uri: vscode.Uri,
        options: vscode.TimelineOptions
    ): Promise<vscode.Timeline> {
        // if the limit is a number and there's no cursor,
        // this is the initial call for the timeline provider used when opening the file.
        // Just get the requested limit to prevent excessive resource usage
        const max =
            typeof options.limit === "number" && options.cursor === undefined
                ? options.limit
                : undefined;
        const isInitialCall = max !== undefined;

        const cached = this.getCachedItems(uri, isInitialCall);
        const items = cached?.items ?? (await this.getHistoryAndItems(uri, max));

        return {
            items,
            paging: { cursor: isInitialCall && items.length === max ? "yes" : undefined },
        };
    }
}

export function registerTimeline() {
    vscode.workspace.registerTimelineProvider(
        ["file", "perforce"],
        new PerforceTimelineProvider()
    );
}

export function openQuickPick(item: PerforceTimelineItem) {
    showQuickPickForFile(item.perforceUri);
}

export function openChangeQuickPick(item: PerforceTimelineItem) {
    showQuickPickForChangelist(item.perforceUri, item.logItem.chnum);
}

function getPreviousInfo(
    uri: vscode.Uri,
    log: p4.FileLogItem,
    prevItem?: p4.FileLogItem
) {
    if (prevItem) {
        // explicit previous item known, could be a different depot file
        return {
            leftFile: PerforceUri.fromDepotPath(uri, prevItem.file, prevItem.revision),
        };
    } else if (log.revision !== "1") {
        // prev revisions that haven't been loaded yet
        return {
            leftFile: PerforceUri.fromDepotPath(
                uri,
                log.file,
                (parseInt(log.revision) - 1).toString()
            ),
        };
    }
    // rev 1 and no previous revision, probably a new file
    return {
        leftFile: vscode.Uri.parse("perforce:EMPTY"),
        title: DiffProvider.diffTitleForDepotPaths(log.file, "0", log.file, log.revision),
    };
}

export async function diffPrevious(item: PerforceTimelineItem) {
    const { leftFile, title } = getPreviousInfo(
        item.perforceUri,
        item.logItem,
        item.prevItem
    );

    await DiffProvider.diffFiles(leftFile, item.perforceUri, title);
}

export async function diffLatest(item: PerforceTimelineItem) {
    await DiffProvider.diffFiles(
        item.perforceUri,
        PerforceUri.fromDepotPath(
            item.perforceUri,
            item.latestItem.file,
            item.latestItem.revision
        )
    );
}

export async function diffLocal(item: PerforceTimelineItem) {
    if (!item.localFile) {
        throw new Error("No local file for item");
    }
    await DiffProvider.diffFiles(item.perforceUri, item.localFile);
}

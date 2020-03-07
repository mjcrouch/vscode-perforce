import * as vscode from "vscode";
import * as p4 from "./api/PerforceApi";

import TimeAgo from "javascript-time-ago";
import * as en from "javascript-time-ago/locale/en";
import { isTruthy } from "./api/CommandUtils";
import { Utils } from "./Utils";
import * as DiffProvider from "./DiffProvider";

TimeAgo.addLocale(en);

const timeAgo = new TimeAgo("en-US");

const columnWidth = 45;

function truncate(str: string, maxLength: number): string {
    if (str.length > maxLength) {
        return str.slice(0, maxLength) + "…";
    }
    return str;
}

function doubleUpNewlines(str: string) {
    return str.replace(/\n+/g, "\n\n");
}

function replaceWhitespace(str: string) {
    return str.replace(/\s/g, "\xa0");
}

function makeSummaryText(change: p4.FileLogItem, fitWidth: number) {
    const timeStr = change.date ? timeAgo.format(change.date) : "Unknown";
    //const chnumStr = "#" + change.chnum + ": ";
    const descWidth = fitWidth - timeStr.length - 2;

    const desc = truncate(replaceWhitespace(change?.description ?? "Unknown"), descWidth);
    // non-breaking space
    const padSpaces = "\xa0".repeat(descWidth + 2 - desc.length);

    return desc + padSpaces + timeStr;
}

function makeUserAndDateSummary(change: p4.FileLogItem) {
    const dateOptions: Intl.DateTimeFormatOptions = {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "numeric"
    };
    return (
        change.file +
        "#" +
        change.revision +
        "\n\n" +
        "**Change `#" +
        change.chnum +
        "`** by **`" +
        change.user +
        "`** on `" +
        (change.date?.toLocaleString(vscode.env.language, dateOptions) ?? "???") +
        "`"
    );
}

function makeSwarmHostURL(change: p4.FileLogItem, swarmHost: string) {
    return swarmHost + "/changes/" + change.chnum;
}

function makeCommandURI(command: string, ...args: any[]) {
    const encoded = encodeURIComponent(JSON.stringify(args));
    return "command:" + command + "?" + encoded;
}

function makeDiffURI(prevChange: p4.FileLogItem, change: p4.FileLogItem) {
    const args = [makePerforceURI(prevChange), makePerforceURI(change)];
    return (
        makeCommandURI("perforce.diffFiles", ...args) +
        ' "' +
        DiffProvider.diffTitleForDepotPaths(
            prevChange.file,
            prevChange.revision,
            change.file,
            change.revision
        ) +
        '"'
    );
}

function makePerforceURI(change: p4.FileLogItem) {
    const baseUri = vscode.Uri.parse("perforce:" + change.file).with({
        fragment: change.revision
    });
    return Utils.makePerforceDocUri(baseUri, "print", "-q", { depot: true });
}

function makeAnnotateURI(change: p4.FileLogItem) {
    const args = makePerforceURI(change).toString();
    return makeCommandURI("perforce.annotate", args);
}

function makeHoverMessage(
    change: p4.FileLogItem,
    latestChange: p4.FileLogItem,
    prevChange?: p4.FileLogItem,
    swarmHost?: string
): vscode.MarkdownString {
    const diffLink = prevChange
        ? "\\[[Diff Previous](" + makeDiffURI(prevChange, change) + ")\\]"
        : "";
    const diffLatestLink =
        change !== latestChange
            ? "\\[[Diff Latest](" + makeDiffURI(change, latestChange) + ")\\]"
            : "";
    const annotateLink =
        change !== latestChange
            ? "\\[[Annotate](" + makeAnnotateURI(change) + ")\\]"
            : "";
    const swarmLink = swarmHost
        ? "\\[[Open in Swarm](" + makeSwarmHostURL(change, swarmHost) + ")\\]"
        : undefined;

    const links = [swarmLink, diffLink, diffLatestLink, annotateLink]
        .filter(isTruthy)
        .join(" ");

    const md = new vscode.MarkdownString(
        makeUserAndDateSummary(change) +
            "\n\n" +
            links +
            "\n\n" +
            doubleUpNewlines(change.description)
    );
    md.isTrusted = true;

    return md;
}

function getDecorations(
    swarmHost: string | undefined,
    annotations: (p4.Annotation | undefined)[],
    log: p4.FileLogItem[]
): vscode.DecorationOptions[] {
    //const decorateColors: string[] = ["rgb(153, 153, 153)", "rgb(103, 103, 103)"];
    const backgroundColor = new vscode.ThemeColor("perforce.gutterBackgroundColor");
    const foregroundColor = new vscode.ThemeColor("perforce.gutterForegroundColor");
    let lastNum = "";

    const latestChange = log[0];

    return annotations
        .map((a, i) => {
            const usePrevious =
                i > 0 && a?.revisionOrChnum === annotations[i - 1]?.revisionOrChnum;
            const annotation = usePrevious ? annotations[i - 1] : a;

            if (!annotation) {
                return;
            }

            const changeIndex = log.findIndex(
                l => l.chnum === annotation.revisionOrChnum
            );
            const change = changeIndex >= 0 ? log[changeIndex] : undefined;
            const prevChange = log[changeIndex + 1];

            const summary = usePrevious
                ? "\xa0"
                : change
                ? makeSummaryText(change, columnWidth)
                : "Unknown!";

            const num = annotation.revisionOrChnum;
            const hoverMessage = change
                ? makeHoverMessage(change, latestChange, prevChange, swarmHost)
                : num;

            if (num !== lastNum) {
                lastNum = num;
            }

            const before: vscode.ThemableDecorationAttachmentRenderOptions = {
                contentText: "\xa0" + summary,
                color: foregroundColor,
                width: columnWidth + 2 + "ch",
                backgroundColor
            };
            const renderOptions: vscode.DecorationInstanceRenderOptions = { before };

            return {
                range: new vscode.Range(i, 0, i, 0),
                hoverMessage,
                renderOptions
            };
        })
        .filter(isTruthy);
}

export async function annotate(uri: vscode.Uri, swarmHost?: string) {
    // TODO don't annotate an already annotated file!

    const annotationsPromise = p4.annotate(uri, {
        file: uri,
        outputChangelist: true,
        followBranches: true
    });

    const logPromise = p4.getFileHistory(uri, { file: uri, followBranches: true });

    const [annotations, log] = await Promise.all([annotationsPromise, logPromise]);

    const decorations = getDecorations(swarmHost, annotations, log);
    printAndDecorate(uri, decorations);
}

async function printAndDecorate(
    uri: vscode.Uri,
    decorations: vscode.DecorationOptions[]
) {
    const decorationType = vscode.window.createTextEditorDecorationType({
        isWholeLine: true,
        before: {
            margin: "0 1.75em 0 0"
        }
    });

    const p4Uri = Utils.makePerforceDocUri(uri, "print", "-q");
    const editor = await vscode.window.showTextDocument(p4Uri);
    editor.setDecorations(decorationType, decorations);
}

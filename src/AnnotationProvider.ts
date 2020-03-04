import * as vscode from "vscode";
import * as p4 from "./api/PerforceApi";

import TimeAgo from "javascript-time-ago";
import * as en from "javascript-time-ago/locale/en";
import { isTruthy } from "./api/CommandUtils";
import { Utils } from "./Utils";

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

function makeDiffURI(_change: p4.FileLogItem) {
    // TODO - the command to diff arbitrary revisions
    return "command:perforce.diff";
}

function makeHoverMessage(
    change: p4.FileLogItem,
    swarmHost?: string
): vscode.MarkdownString {
    const diffLink = "\\[[Show Diff](" + makeDiffURI(change) + ")\\]";
    const swarmLink = swarmHost
        ? "\\[[Open in Swarm](" + makeSwarmHostURL(change, swarmHost) + ")\\]"
        : undefined;

    const links = [swarmLink, diffLink].filter(isTruthy).join(" ");

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

    return annotations
        .map((a, i) => {
            const usePrevious =
                i > 0 && a?.revisionOrChnum === annotations[i - 1]?.revisionOrChnum;
            const annotation = usePrevious ? annotations[i - 1] : a;

            if (!annotation) {
                return;
            }

            const change = log.find(l => l.chnum === annotation.revisionOrChnum);
            const summary = usePrevious
                ? "\xa0"
                : change
                ? makeSummaryText(change, columnWidth)
                : "Unknown!";

            const num = annotation.revisionOrChnum;
            const hoverMessage = change ? makeHoverMessage(change, swarmHost) : num;

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
        outputChangelist: true
    });

    const logPromise = p4.getFileHistory(uri, { file: uri });

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

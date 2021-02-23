import {
    FileDecoration,
    SourceControlResourceDecorations,
    ThemeColor,
    Uri,
} from "vscode";
import { Status } from "./Status";
import * as path from "path";
import { getStatusText } from "../test/helpers/testUtils";
import { isTruthy } from "../TsUtils";

export class DecorationProvider {
    private static _iconsRootPath: string = path.join(
        path.dirname(__dirname),
        "resources",
        "icons"
    );

    public static getDecorations(
        statuses: Status[],
        isShelved: boolean,
        isUnresolved: boolean
    ): SourceControlResourceDecorations {
        const status = this.getDominantStatus(statuses);
        const light = {
            iconPath: DecorationProvider.getIconPath(
                status,
                isShelved,
                isUnresolved,
                "light"
            ),
        };
        const dark = {
            iconPath: DecorationProvider.getIconPath(
                status,
                isShelved,
                isUnresolved,
                "dark"
            ),
        };

        const strikeThrough = DecorationProvider.useStrikeThrough(status);
        const faded = isShelved;
        const tooltip = this.getTooltipText(status, isShelved, isUnresolved);

        return { strikeThrough, faded, light, dark, tooltip };
    }

    public static getFileDecorations(
        statuses: Status[],
        isUnresolved: boolean
    ): FileDecoration {
        const status = this.getDominantStatus(statuses);
        const text = DecorationProvider.getStatusDecorations(status);
        const tooltip = isUnresolved ? text.tooltip + " - unresolved" : text.tooltip;
        const colorName = isUnresolved ? "unresolved" : text.colorName;
        return {
            tooltip,
            badge: text.badge,
            color: colorName
                ? new ThemeColor("perforceDecoration." + colorName + "Foreground")
                : undefined,
            propagate: true,
        };
    }

    private static getDominantStatus(statuses: Status[]) {
        if (!statuses || statuses.length === 0) {
            return undefined;
        }

        // if there's only one just return it
        if (statuses.length === 1) {
            return statuses[0];
        }

        // The most dominant types are ADD, EDIT, and DELETE
        let index: number = statuses.findIndex(
            (s) => s === Status.ADD || s === Status.EDIT || s === Status.DELETE
        );
        if (index >= 0) {
            return statuses[index];
        }

        // The next dominant type is MOVE
        index = statuses.findIndex(
            (s) => s === Status.MOVE_ADD || s === Status.MOVE_DELETE
        );
        if (index >= 0) {
            return statuses[index];
        }

        // After that, just return the first one
        return statuses[0];
    }

    private static getTooltipText(
        status: Status | undefined,
        isShelved: boolean,
        isUnresolved: boolean
    ) {
        const items = [
            isShelved ? "Shelved" : undefined,
            status !== undefined ? getStatusText(status) : undefined,
            isUnresolved ? "NEEDS RESOLVE" : undefined,
        ];
        return items.filter(isTruthy).join(" - ");
    }

    private static getIconUri(iconName: string, theme: string): Uri {
        return Uri.file(
            path.join(DecorationProvider._iconsRootPath, theme, `${iconName}.svg`)
        );
    }

    private static getIconPath(
        status: Status | undefined,
        isShelved: boolean,
        isUnresolved: boolean,
        theme: string
    ): Uri | undefined {
        const base =
            "status-" +
            (isShelved ? "shelve-" : "") +
            (isUnresolved ? "unresolved-" : "");
        switch (status) {
            case Status.ADD:
                return DecorationProvider.getIconUri(base + "add", theme);
            case Status.ARCHIVE:
                return DecorationProvider.getIconUri(base + "archive", theme);
            case Status.BRANCH:
                return DecorationProvider.getIconUri(base + "branch", theme);
            case Status.DELETE:
                return DecorationProvider.getIconUri(base + "delete", theme);
            case Status.EDIT:
                return DecorationProvider.getIconUri(base + "edit", theme);
            case Status.IMPORT:
                return DecorationProvider.getIconUri(base + "integrate", theme);
            case Status.INTEGRATE:
                return DecorationProvider.getIconUri(base + "integrate", theme);
            case Status.LOCK:
                return DecorationProvider.getIconUri(base + "lock", theme);
            case Status.MOVE_ADD:
                return DecorationProvider.getIconUri(base + "move", theme);
            case Status.MOVE_DELETE:
                return DecorationProvider.getIconUri(base + "move", theme);
            case Status.PURGE:
                return DecorationProvider.getIconUri(base + "delete", theme);
            default:
                return void 0;
        }
    }

    private static useStrikeThrough(status?: Status): boolean {
        return status === Status.DELETE || status === Status.MOVE_DELETE;
    }

    private static getStatusDecorations(
        status?: Status
    ): { badge?: string; tooltip?: string; colorName?: string } {
        switch (status) {
            case Status.ADD:
                return { badge: "A", tooltip: "Add", colorName: "add" };
            case Status.ARCHIVE:
                return { badge: "a", tooltip: "Archive", colorName: "archive" };
            case Status.BRANCH:
                return { badge: "B", tooltip: "Branch", colorName: "branch" };
            case Status.DELETE:
                return { badge: "D", tooltip: "Delete", colorName: "delete" };
            case Status.EDIT:
                return { badge: "E", tooltip: "Edit", colorName: "edit" };
            case Status.IMPORT:
                return { badge: "i", tooltip: "Import", colorName: "import" };
            case Status.INTEGRATE:
                return { badge: "I", tooltip: "Integrate", colorName: "integrate" };
            case Status.LOCK:
                return { badge: "L", tooltip: "Lock", colorName: "lock" };
            case Status.MOVE_ADD:
                return { badge: "M", tooltip: "Move/Add", colorName: "moveAdd" };
            case Status.MOVE_DELETE:
                return { badge: "M", tooltip: "Move/Delete", colorName: "moveDelete" };
            case Status.PURGE:
                return { badge: "P", tooltip: "Purge", colorName: "purge" };
            default:
                return {};
        }
    }
}

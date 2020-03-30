import * as QuickPickProvider from "./QuickPickProvider";
import * as FileQuickPick from "./FileQuickPick";
import * as ChangeQuickPick from "./ChangeQuickPick";

export const showQuickPickForFile = FileQuickPick.showQuickPickForFile;

export function registerQuickPicks() {
    QuickPickProvider.registerQuickPickProvider(
        "file",
        FileQuickPick.fileQuickPickProvider
    );
    QuickPickProvider.registerQuickPickProvider(
        "change",
        ChangeQuickPick.changeQuickPickProvider
    );
}

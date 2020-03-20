import { expect } from "chai";

import * as vscode from "vscode";

import { Utils } from "../../Utils";
// TODO test in a different file!
import * as PerforceUri from "../../PerforceUri";

describe("Utils module", () => {
    describe("Perforce Uris", () => {
        const depotPath = "//depot/my/path/file.txt";
        const depotUri = vscode.Uri.file(depotPath);

        it("Can determine a valid path from a Uri", () => {
            expect(PerforceUri.getDepotPathFromDepotUri(depotUri)).to.be.equal(depotPath);
        });
        it("Can encode and decode a URI Query", () => {
            const query = PerforceUri.encodeQuery({
                command: "print",
                p4Args: "-q",
                depot: true
                //leftDepotPath: "s&t=uff"
            });
            expect(query).to.equal(
                "p4args=-q&command=print&depot&leftDepotPath=s%26t%3Duff"
            );

            const decoded = PerforceUri.decodeUriQuery(query);
            expect(decoded).to.deep.equal({
                p4args: "-q",
                command: "print",
                depot: true,
                stringArg: "s&t=uff"
            });
        });
        it("Can make a full perforce doc URI", () => {
            const uri = PerforceUri.fromUri(depotUri, {
                depot: true
            });
            expect(uri.scheme).to.equal("perforce");
            expect(uri.authority).to.equal("depot");
            expect(uri.query).to.equal("p4args=-q&command=print&depot");
        });
    });
    describe("Path expansion", () => {
        it("Escapes special characters", () => {
            const path = "AFile%*#@.txt";
            expect(Utils.expansePath(path)).to.equal("AFile%25%2A%23%40.txt");
        });
        // TODO local dir settings (what is this for?)
    });
});

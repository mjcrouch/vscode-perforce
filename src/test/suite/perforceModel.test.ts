import * as p4 from "../../model/PerforceModel";
import * as vscode from "vscode";
import * as sinon from "sinon";
import { PerforceService } from "../../PerforceService";
import { getWorkspaceUri, returnStdOut } from "../helpers/testUtils";

import { expect } from "chai";
import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import * as sinonChai from "sinon-chai";

chai.use(sinonChai);
chai.use(chaiAsPromised);

function basicExecuteStub(
    _resource: vscode.Uri,
    command: string,
    responseCallback: (err: Error | null, stdout: string, stderr: string) => void,
    args?: string,
    _directoryOverride?: string | null,
    _input?: string
) {
    let out = command;
    if (args) {
        out += " " + args;
    }
    setImmediate(() => responseCallback(null, out, ""));
}

function execWithResult(err: Error | null, stdout: string, stderr: string) {
    return (
        _resource: any,
        _command: string,
        responseCallback: (err: Error | null, stdout: string, stderr: string) => void
    ) => {
        setImmediate(() => responseCallback(err, stdout, stderr));
    };
}

function execWithStdOut(stdout: string) {
    return execWithResult(null, stdout, "");
}

function execWithStdErr(stderr: string) {
    return execWithResult(null, "", stderr);
}

function execWithErr(err: Error) {
    return execWithResult(err, "", "");
}

describe("Perforce Model", () => {
    let execute: sinon.SinonStub<Parameters<typeof basicExecuteStub>, void>;
    const ws = getWorkspaceUri();

    beforeEach(() => {
        execute = sinon.stub(PerforceService, "execute").callsFake(basicExecuteStub);
    });
    afterEach(() => {
        expect(execute).to.always.have.been.calledWith(ws);
        sinon.restore();
    });
    describe("Flag mapper", () => {
        it("maps flags");
    });
    describe("Simple commands", () => {
        it("makes a simple command");
    });
    describe("Get change Spec", () => {
        it("Outputs a change spec", async () => {
            execute.callsFake(
                returnStdOut(
                    "# A Perforce Change Specification.\n" +
                        "#\n" +
                        "#  Change:      The change number. 'new' on a new changelist.\n" +
                        "#  Date:        The date this specification was last modified.\n" +
                        "#  etc\n" +
                        "\n" +
                        "Change:	new\n" +
                        "\n" +
                        "Client:	cli\n" +
                        "\n" +
                        "User:	user\n" +
                        "\n" +
                        "Status:	new\n" +
                        "\n" +
                        "Description:\n" +
                        "<enter description here>\n" +
                        "\n" +
                        "Files:\n" +
                        "//depot/testArea/testFile	# edit\n"
                )
            );
            await expect(p4.getChangeSpec(ws, {})).to.eventually.deep.equal({
                description: "<enter description here>",
                files: [{ depotPath: "//depot/testArea/testFile", action: "edit" }],
                change: "new",
                rawFields: [
                    { name: "Change", value: "\tnew" },
                    { name: "Client", value: "\tcli" },
                    { name: "User", value: "\tuser" }
                ]
            });
        });
    });
    describe("Input change spec", () => {
        it("Inputs a change spec and returns the change number");
    });
    describe("fstat", () => {
        it("Returns fstat info in the same order as the input");
        it("Uses multiple fstat commands if necessary");
    });
    describe("get opened files", () => {
        it("Returns the list of opened files");
        it("Does not throw on stderr", async () => {
            execute.callsFake(execWithStdErr("no open files"));
            await expect(p4.getOpenedFiles(ws, {})).to.eventually.eql([]);
        });
    });
    describe("submit", () => {
        it("uses the correct arguments", async () => {
            await expect(
                p4.submitChangelist(ws, { chnum: "1", description: "my description" })
            ).to.eventually.equal("submit -c 1 -d my description");
        });
    });
    describe("revert", () => {
        it("uses the correct arguments", async () => {
            await expect(
                p4.revert(ws, {
                    unchanged: true,
                    chnum: "1",
                    paths: [{ fsPath: "myfile.txt" }]
                })
            ).to.eventually.equal('revert -a -c 1 "myfile.txt"');
        });
    });
    describe("shelve", () => {
        it("uses the correct arguments", async () => {
            await expect(
                p4.shelve(ws, {
                    delete: true,
                    force: true,
                    chnum: "99",
                    paths: ["myfile.txt"]
                })
            ).to.eventually.equal('shelve -f -d -c 99 "myfile.txt"');
        });
    });
    describe("unshelve", () => {
        it("uses the correct arguments", async () => {
            await expect(
                p4.unshelve(ws, {
                    shelvedChnum: "99",
                    toChnum: "1",
                    force: true,
                    paths: ["myfile.txt"]
                })
            ).to.eventually.equal('unshelve -f -s 99 -c 1 "myfile.txt"');
        });
    });
    describe("fix job", () => {
        it("uses the correct arguments", async () => {
            await expect(
                p4.fixJob(ws, {
                    chnum: "123456",
                    jobId: "job000001",
                    removeFix: true
                })
            ).to.eventually.equal("fix -c 123456 -d job000001");
        });
    });
    describe("reopen", () => {
        it("uses the correct arguments", async () => {
            await expect(
                p4.reopenFiles(ws, {
                    chnum: "default",
                    files: ["a.txt", "b.txt"]
                })
            ).to.eventually.equal('reopen -c default "a.txt" "b.txt"');
        });
    });
    describe("sync", () => {
        it("uses the correct arguments", async () => {
            await expect(p4.sync(ws, {})).to.eventually.equal("sync");
        });
    });
    describe("getChangelists", () => {
        it("Returns the list of open changelists");
    });
    describe("getShelvedFiles", () => {
        it("Returns the list of shelved files");
    });
    describe("fixedJobs", () => {
        it("Returns the list of jobs fixed by a changelist");
    });
    describe("info", () => {
        it("Returns a map of info fields");
    });
    describe("have file", () => {
        it("Returns true if stdout has output");
        it("Returns false if stderr has output");
        it("Returns false on error");
    });
    describe("isLoggedIn", () => {
        it("Returns true on stdout", async () => {
            execute.callsFake(execWithStdOut("login ok"));
            await expect(p4.isLoggedIn(ws)).to.eventually.equal(true);
        });
        it("Returns false on stderr", async () => {
            execute.callsFake(execWithStdErr("not logged in"));
            await expect(p4.isLoggedIn(ws)).to.eventually.equal(false);
        });
        it("Returns false on err", async () => {
            execute.callsFake(execWithErr(new Error("oh no")));
            await expect(p4.isLoggedIn(ws)).to.eventually.equal(false);
        });
    });
    describe("login", () => {
        it("uses the correct arguments");
    });
    describe("logout", () => {
        it("uses the correct arguments", async () => {
            await expect(p4.logout(ws, {})).to.eventually.equal("logout");
        });
    });
});

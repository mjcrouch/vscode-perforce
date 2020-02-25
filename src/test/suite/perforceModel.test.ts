import * as p4 from "../../model/PerforceModel";
import * as vscode from "vscode";
import * as sinon from "sinon";
import { PerforceService } from "../../PerforceService";
import { getWorkspaceUri } from "../helpers/testUtils";

import { expect } from "chai";
import * as chai from "chai";
import * as chaiAsPromised from "chai-as-promised";
import * as sinonChai from "sinon-chai";
import { ChangeSpec } from "../../model/CommonTypes";

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
                execWithStdOut(
                    "# A Perforce Change Specification.\n" +
                        "#\n" +
                        "#  Change:      The change number. 'new' on a new changelist.\n" +
                        "#  Date:        The date this specification was last modified.\n" +
                        "#  etc\n" +
                        "\n" +
                        "Change:\tnew\n" +
                        "\n" +
                        "Client:\tcli\n" +
                        "\n" +
                        "User:\tuser\n" +
                        "\n" +
                        "Status:\tnew\n" +
                        "\n" +
                        "Description:\n" +
                        "\t<enter description here>\n" +
                        "\n" +
                        "Files:\n" +
                        "//depot/testArea/testFile\t# edit"
                )
            );
            await expect(p4.getChangeSpec(ws, {})).to.eventually.deep.equal({
                description: "<enter description here>",
                files: [{ depotPath: "//depot/testArea/testFile", action: "edit" }],
                change: "new",
                rawFields: [
                    { name: "Change", value: ["new"] },
                    { name: "Client", value: ["cli"] },
                    { name: "User", value: ["user"] },
                    { name: "Status", value: ["new"] },
                    { name: "Description", value: ["<enter description here>"] },
                    { name: "Files", value: ["//depot/testArea/testFile\t# edit"] }
                ]
            });
        });
        it("Outputs a change spec for an existing changelist", async () => {
            execute.callsFake(
                execWithStdOut(
                    "# A Perforce Change Specification.\n" +
                        "#\n" +
                        "#  Change:      The change number. 'new' on a new changelist.\n" +
                        "#  Date:        The date this specification was last modified.\n" +
                        "#  etc\n" +
                        "\n" +
                        "Change:\t123\n" +
                        "\n" +
                        "Client:\tcli\n" +
                        "\n" +
                        "User:\tuser\n" +
                        "\n" +
                        "Status:\tpending\n" +
                        "\n" +
                        "Description:\n" +
                        "\tchangelist line 1\n\tchangelist line 2"
                )
            );
            await expect(
                p4.getChangeSpec(ws, { existingChangelist: "123" })
            ).to.eventually.deep.equal({
                description: "changelist line 1\nchangelist line 2",
                change: "123",
                files: undefined,
                rawFields: [
                    { name: "Change", value: ["123"] },
                    { name: "Client", value: ["cli"] },
                    { name: "User", value: ["user"] },
                    { name: "Status", value: ["pending"] },
                    {
                        name: "Description",
                        value: ["changelist line 1", "changelist line 2"]
                    }
                ]
            });
        });
    });
    describe("Input change spec", () => {
        it("Inputs a change spec and returns the change number", async () => {
            execute.callsFake(execWithStdOut("Change 99 created."));
            const changeSpec: ChangeSpec = {
                description: "my change spec\nhere it is",
                change: "new",
                files: [{ depotPath: "//depot/testArea/myFile.txt", action: "add" }],
                rawFields: []
            };
            await expect(
                p4.inputChangeSpec(ws, { spec: changeSpec })
            ).to.eventually.deep.equal({ rawOutput: "Change 99 created.", chnum: "99" });

            expect(execute).to.have.been.calledWithMatch(
                ws,
                "change",
                sinon.match.any,
                "-i",
                null,
                "Change:\tnew\n\n" +
                    "Description:\tmy change spec\n\there it is\n\n" +
                    "Files:\t//depot/testArea/myFile.txt\t# add"
            );
        });
        it("Updates an existing change spec and returns the change number", async () => {
            execute.callsFake(execWithStdOut("Change 1234 updated."));
            const changeSpec: ChangeSpec = {
                description: "a spec",
                change: "1234",
                files: [{ depotPath: "//depot/testArea/myEdit.txt", action: "edit" }],
                rawFields: [
                    { name: "Description", value: ["no-override"] },
                    { name: "Raw", value: ["value"] }
                ]
            };
            await expect(
                p4.inputChangeSpec(ws, { spec: changeSpec })
            ).to.eventually.deep.equal({
                rawOutput: "Change 1234 updated.",
                chnum: "1234"
            });

            expect(execute).to.have.been.calledWithMatch(
                ws,
                "change",
                sinon.match.any,
                "-i",
                null,
                "Change:\t1234\n\n" +
                    "Description:\ta spec\n\n" +
                    "Files:\t//depot/testArea/myEdit.txt\t# edit\n\n" +
                    "Raw:\tvalue"
            );
        });
        it("Uses the raw value for a high-level field when not supplied", async () => {
            execute.callsFake(execWithStdOut("Change 1234 updated."));
            const changeSpec: ChangeSpec = {
                description: undefined,
                change: "1234",
                files: [{ depotPath: "//depot/testArea/myEdit.txt", action: "edit" }],
                rawFields: [{ name: "Description", value: ["override"] }]
            };
            await expect(
                p4.inputChangeSpec(ws, { spec: changeSpec })
            ).to.eventually.deep.equal({
                rawOutput: "Change 1234 updated.",
                chnum: "1234"
            });

            expect(execute).to.have.been.calledWithMatch(
                ws,
                "change",
                sinon.match.any,
                "-i",
                null,
                "Change:\t1234\n\n" +
                    "Files:\t//depot/testArea/myEdit.txt\t# edit\n\n" +
                    "Description:\toverride"
            );
        });
        it("Throws an error on stderr", async () => {
            execute.callsFake(execWithStdErr("Your spec is terrible."));
            const changeSpec: ChangeSpec = {
                description: undefined,
                change: "1234",
                files: [{ depotPath: "//depot/testArea/myEdit.txt", action: "edit" }],
                rawFields: [{ name: "Description", value: ["override"] }]
            };

            await expect(
                p4.inputChangeSpec(ws, { spec: changeSpec })
            ).to.eventually.be.rejectedWith("Your spec is terrible.");
        });
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
            ).to.eventually.equal('fix -c 123456 -d "job000001"');
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
        it("Uses the correct arguments", async () => {
            await p4.haveFile(ws, { file: "//depot/testArea/myFile.txt" }); // TODO local path
            expect(execute).to.have.been.calledWith(
                ws,
                "have",
                sinon.match.any,
                '"//depot/testArea/myFile.txt"'
            );
        });
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

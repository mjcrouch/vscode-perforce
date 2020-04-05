# vscode-perforce

[![VS Code marketplace button](https://vsmarketplacebadge.apphb.com/installs/mjcrouch.perforce.svg)](https://marketplace.visualstudio.com/items/mjcrouch.perforce)
[![GitHub issues](https://img.shields.io/github/issues/mjcrouch/vscode-perforce.svg)](https://github.com/mjcrouch/vscode-perforce/issues)
[![GitHub license button](https://img.shields.io/github/license/mjcrouch/vscode-perforce.svg)](https://github.com/mjcrouch/vscode-perforce/blob/master/LICENSE.txt)  
[![Build Status](https://dev.azure.com/mjcrouch/vscode-perforce/_apis/build/status/mjcrouch.vscode-perforce?branchName=master)](https://dev.azure.com/mjcrouch/vscode-perforce/_build/latest?definitionId=1&branchName=master)
[![Test Status](https://img.shields.io/azure-devops/tests/mjcrouch/vscode-perforce/1/master)](https://dev.azure.com/mjcrouch/vscode-perforce/_build/latest?definitionId=1&branchName=master)  
[![Dependency Status](https://img.shields.io/david/mjcrouch/vscode-perforce.svg)](https://david-dm.org/mjcrouch/vscode-perforce)
[![Dev Dependency Status](https://img.shields.io/david/dev/mjcrouch/vscode-perforce.svg)](https://david-dm.org/mjcrouch/vscode-perforce?type=dev)  

Perforce integration for Visual Studio Code

This is a fork of the `slevesque.perforce` extension, published in 2020, as the original creator now appears to be inactive on GitHub.

If you install this extension, please uninstall or disable `slevesque.perforce` to prevent issues with duplicate icons.

If you are installing for the first time, Proceed to [the setup section](#Setup) for setup instructions. If you have a working setup from the old extension, it will probably continue to work.

## What's included?

### All the features you've come to expect

Built on the foundation of the most installed perforce extension on the market, it has all the core features you already know

### Login & go

If your perforce server requires a password, you can log in from within VS Code

![Login Example](images/login.gif)

### Integration with VS Code's SCM View

* Create and manage your open changelists from the built in SCM View
* Submit and revert changelists
* Shelve and unshelve files
* Move files between changelists
* Click on an open file to see the diff

### Run common perforce operations on the open file

Click on the 'p4' in the status bar to perform an operation

* `add` - Open a new file to add it to the depot
* `edit` - Open an existing file for edit
* `revert` - Discard changes from an opened file
* `diff` - Display diff of client file with depot file
* `diff revision` - Display diff of client file with depot file at a specific revision
* `login`, `logout` - Login operations
* ... and more!

### Automatically open files for add and edit as you work

* Enable the settings `perforce.editOnFileSave`, `perforce.addOnFileCreate` and `perforce.deleteOnFileDelete` to automatically perform depot operations without that pesky warning dialog

### Diff files using VS Code's built in tools

* Diff the open file against the workspace file
* Diff against any revision of a file
* See diffs as you work with gutter decorations

## What's new in the fork?

The fork has a variety of new features to help you manage your changes and understand your code history, without having to switch to p4v or the command line.

We've borrowed ideas from popular extensions like [GitLens](https://marketplace.visualstudio.com/items?itemName=eamodio.gitlens) and... okay, mainly just GitLens, adapting them for the perforce workflow.

And there's still lots of new features to implement to improve your experience without getting in the way.

### Improved annotation view

See more context about each line, including the author and the changelist description.

The format of the annotations is customisable if this is too much information

### All new revision & changelist quick pick

Looking at a diff or annotation? Dive in to the depot with a single click to see some context:

* Browse through revisions and file history
* See integrations into and from the file
* See other files in the same changelist
* Using swarm for reviews? click through to the swarm review
* ... more :)

### Improved diff behaviour

* Diffs against the have revision, not the latest revision
  * This includes the gutter decorations - so you'll have an accurate view of what you've actually changed
  * But you can still manually select a newer revision for a diff if needed
* Click through revisions using the left and right arrows
* Diff a shelved file against its depot revision, or the current workspace file
* Automatically diffs a moved file against the original file

### Much more!

Internally, almost every feature has been refactored, rewritten or touched in some way

This fork fixes many issues from the original extension and adds a variety of other new features. A few more examples:

* Adds support for attaching jobs to changelists
* Improved support for shelved files & changelists
* Works more reliably with [personal servers](https://github.com/stef-levesque/vscode-perforce/issues/169#issuecomment-592976290)
* Ability to move selected file from the default changelist to a new changelist

[Head over to the changelog](CHANGELOG.md) to see everything that's changed

But there is still lots more to do. [Feedback](https://github.com/mjcrouch/vscode-perforce/issues)
 and [contributions](CONTRIBUTING.md) are welcome!

## Installation

1. Install *[Visual Studio Code](https://code.visualstudio.com/)*
2. Launch *Code*
3. From the command palette `ctrl+shift+p` (Windows, Linux) or `cmd+shift+p` (OS X)
4. Select `Install Extensions`
5. Choose the extension `Perforce for VS Code` by `mjcrouch`
6. Reload *Visual Studio Code*

Or [visit us on the marketplace](https://marketplace.visualstudio.com/items/mjcrouch.perforce)

## Setup

You must properly configure a perforce depot area before the extension activates.

If you try to run a command, and VS Code tells you **"command not found"** it means the extension has not found a valid perforce depot area. Don't forget, if you are tweaking settings, internally or externally, you probably need to restart VS code for the extension to perform this detection again.

Please note that there is still some work to do in this area, which is [being tracked in an issue](https://github.com/mjcrouch/vscode-perforce/issues/41)

#### Having trouble? Output log to the rescue

If you are having trouble, check the **output log** for Perforce. Here, you will be able to see what the extension is trying to do, and what it has found during initialisation

To see the output log, you can run the command "Perforce: Show Output", or you can reach it from `View` -> `Output` and select Perforce in the dropdown

### The Best Way

The best way to setup your perforce workspace is using perforce's own standard behaviour and tools.

The perforce extension uses the standard p4 command line interface. If you can run perforce commands in your workspace directory without any additional setup, then you *should* be able to use the perforce extension without extra configuration.

#### The simplest setup

So, in a very simple case, for example where you always work in one particular perforce client, you could

* Use `p4 set` to set your `P4USER`, `P4PORT`, `P4CLIENT` to the correct values, OR
* Set up your `P4USER`, `P4PORT`, `P4CLIENT` environment variables (e.g. in your `.bashrc` file)

If necessary, restart VS Code and it should *just work*™

#### Multiple perforce clients

If you work across multiple different perforce client workspaces, you can use [P4CONFIG](https://www.perforce.com/perforce/r17.1/manuals/cmdref/index.html#CmdRef/P4CONFIG.html?Highlight=p4config) to set up the different client locations.

Place a p4config file in your client root, like this:

```
P4USER=your_user
P4CLIENT=your_client
P4PORT=example.com:1666
```

and we should be able to pick it up (some issues are pending with more complicated cases, such as having multiple folders open in vscode)

### The Fallback Method

Can't get it to work? Or just want it your own way?

The following VS Code settings will run commands using a specific username, client or port that you provide

```json
{
    "perforce.user": "your_user",
    "perforce.client": "your_client",
    "perforce.port": "example.com:1666"
}
```

Remember that VS Code's settings operate in a hierarchy of `user` and `workspace`. If you set your client in the `user` level of the hierarchy, it will apply to **all** of your VS Code workspaces - this may not be desirable, so take care and check the logs if you have issues.

Don't forget you can also combine these approaches, For example, you can set just `perforce.client` in each specific workspace, while using environment variables for your user and port.

### Multi-root workspaces

These settings also support multi-root workspaces, so they can be set at the level of an individual folder within in your multi-root VS Code workspace.

See the VS Code docs: [Multi-root Workspaces - Settings](https://code.visualstudio.com/docs/editor/multi-root-workspaces#_settings) for more details.

### Activation
You can specify how you want the extension to activate by setting the parameter `perforce.activationMode`

* `autodetect` (default) - The extension will only activate if it detects a valid perforce client that contains the workspace root, or a `.p4config` file in the workspace. If one is not detected, perforce commands will not be registered with VSCode, but you will be able to view the perforce output log to see why the extension did not activate
* `always` - Always try to activate the extension, even if a valid client was not found. This may be useful if you want to use perforce commands on files outside of the workspace, **and** you either have perforce set up properly with .p4config files for that area, or you have manually specified a user / client / port etc in your vscode configuration. Otherwise, you should probably avoid this setting
* `off` - Don't try to activate the extension. No perforce log output will be produced

## Status bar icons

* ![check](images/check.png) opened for add or edit
* ![file-text](images/file-text.png) not opened on this client
* ![circle-slash](images/circle-slash.png) not under client's root

## Configuration

|Name                               |Type       |Description
|-----------------------------------|-----------|-----------
|`perforce.client`                  |`string`   |Use the specified client
|`perforce.user`                    |`string`   |Use the specified user
|`perforce.port`                    |`string`   |Use the specified protocol:host:port
|`perforce.password`                |`string`   |Use the specified password
|&nbsp; 
|`perforce.editOnFileSave`          |`boolean`  |Automatically open a file for edit when saved
|`perforce.editOnFileModified`      |`boolean`  |Automatically open a file for edit when Modified
|`perforce.addOnFileCreate`         |`boolean`  |Automatically Add a file to depot when Created
|`perforce.deleteOnFileDelete`      |`boolean`  |Automatically delete a file from depot when deleted
|&nbsp; 
|`perforce.dir`                     |`string`   |Overrides any PWD setting (current working directory) and replaces it with the specified directory
|`perforce.command`                 |`string`   |Configure a path to p4 or an alternate command if needed
|`perforce.realpath`                |`boolean`  |**Experimental** Try to resolve real file path before executing command
|&nbsp; 
|`perforce.activationMode`          |`string`   |Controls when to activate the extension (`always`,`autodetect`,`off`)
|`perforce.countBadge`              |`string`   |Controls the badge counter for Perforce (`all`,`off`)
|`perforce.annotate.followBranches` |`boolean`  |Whether to follow branch actions when annotating a file
|`perforce.annotate.gutterColumns`  |`object`   |**Experimental** Format for annotation summary messages
|`perforce.changelistOrder`         |`string`   |Specifies the direction of the chnagelist sorting (`descending`,`ascending`)
|`perforce.scmFileChanges`          |`boolean`  |Open file changes when selected in SCM Explorer
|`perforce.ignoredChangelistPrefix` |`string`   |Specifies the prefix of the changelists to be ignored.
|`perforce.hideNonWorkspaceFiles`   |`boolean`  |Hide non workspace files in the SCM Explorer. Default changelist only submits files that are opened in current workspace. Warning: If you submit other changelists than the default it will submit files that are not visible.
|`perforce.swarmHost`               |`string`   |Specifies the hostname of the Swarm server for annotation links. (`https://localhost`)
|`perforce.hideShelvedFiles`        |`boolean`  |Hide shelved files in the SCM Explorer.
|`perforce.hideEmptyChangelists`    |`boolean`  |Hide changelists with no file in the SCM Explorer.
|`perforce.hideSubmitIcon`          |`boolean`  |Don't show the submit icon next to the changelist description.
|`perforce.promptBeforeSubmit`      |`boolean`  |Whether to prompt for confirmation before submitting a saved changelist.
|`perforce.editorButtons.diffPrevAndNext`      |`enum`  |Controls when to show buttons on the editor title menu for diffing next / previous
|&nbsp;
|`perforce.bottleneck.maxConcurrent` |`number`  |Limit the maximum number of perforce commands running at any given time.

## Command and Context Variables

The extension provides a few commands and context variables relating to the file currently open in the editor. These can be used in tasks, keyboard shortcuts etc. as required, if you can find a use for them!

For example, the following task prints out the changelist number, provided the current file is open in perforce:

```
    {
        "label": "echo",
        "type": "shell",
        "command": "echo ${command:perforce.currentFile.changelist}"
    }
```

In all cases, the command name and the context variable name are the same

| Name                              | description
|-----------------------------------|---------------
| `perforce.currentFile.status`     | Whether the file is open / in the workspace. Possible values: `OPEN`, `NOT_OPEN`, `NOT_IN_WORKSPACE`
| `perforce.currentFile.depotPath`  | The depot path of the file (**only** provided if the file is open)
| `perforce.currentFile.revision`   | The open revision of the file (**only** provided if the file is open)
| `perforce.currentFile.changelist` | The changelist in which the file is open
| `perforce.currentFile.operation`  | The perforce operation for the file, e.g. `edit`, `move/add`
| `perforce.currentFile.filetype`   | The perforce file type of the file, e.g. `text`

## Common Questions

#### **Q:** vscode reports that commands do not exist
**A:** Make sure you have read [the setup section](#Setup). If all else fails, try setting
`perforce.client`, `perforce.user` and `perforce.port` to the right values for your depot and workspace, and then reload the window. If that does not work, continue below:

#### **Q:** Something is not working
**A:** Here are a few steps you should try first:
1. Make sure you have read [the setup section](#Setup)
1. Look at the logs with `Perforce: Show Output`
1. Search for the [existing issue on GitHub](https://github.com/mjcrouch/vscode-perforce/issues?utf8=✓&q=is%3Aissue)
1. If you can't find your problem, [create an issue](https://github.com/mjcrouch/vscode-perforce/issues/new), and please include the logs when possible

#### **Q:** Does it work with Remote-SSH?
**A:** Yes - you will need to install the extension on the remote instance of VSCode, using the normal extensions view

#### **Q:** My perforce server is slow and shows an file write error even with `editOnFileSave` enabled

When you enable `editOnFileSave`, we tell VS Code to delay saving the file until the edit is complete.

However, there is a time limit for this. If you have a slow or distant perforce server, VS Code may time out the save command before your file has become writable.

A special command is available to edit and save in one operation, bypassing VS Code's timeout.

Using edit on save ensures that the open completes before it tries to save the file.

It's generally not recommended to rebind your ctrl+s keyboard shortcut, due to the small risk that the save never happens if your perforce server never responds, but if you wish, you could rebind your save command like this, to open the file for edit if it's not already open and then save it.

```
{
  "key": "ctrl+s",
  "command": "workbench.action.files.save",
  "when": "perforce.currentFile.status != 'NOT_OPEN'"
}
{
  "key": "ctrl+s",
  "command": "perforce.editAndSave",
  "when": "perforce.currentFile.status == 'NOT_OPEN'"
}
```

## Contributing

[Guide to contributing](CONTRIBUTING.md)

## Requirements

Visual Studio Code v1.40

## Credits

* [Visual Studio Code](https://code.visualstudio.com/)
* [vscode-docs on GitHub](https://github.com/Microsoft/vscode-docs)

## License

[MIT](LICENSE.md)

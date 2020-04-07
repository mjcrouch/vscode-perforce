# Migration Guide

## Introduction

In `mjcrouch.perforce` version 4, the method of detecting perforce client workspaces was changed. This guide applies to anyone upgrading from either the `slevesque.perforce` extension, or upgrading from a pre-v4 version of `mjcrouch.perforce`

In almost all cases, the new extension will continue to work with existing configuration. So first of all, just try it and see if anything breaks!

However, there are a few more unusual setups that *may* not be correctly detected

This guide covers the main changes between these versions in how perforce client workspaces are detected and used, and any action you may need to take

(Remember, if you are switching from the old extension you **must uninstall or disable the `slevesque.perforce` extension** to prevent conflicting behaviour)

## Perforce Output Log

In any case, if you are having trouble, check the perforce output log using the command `Perforce: Show output` or `view->output` and select "Perforce Log" in the dropdown. At the top of the output is detailed information about how it tried to initialise the workspace.

Additionally, each perforce command is prefixed with its working directory, and the full set of parameters is shown. You can run the commands manually in a terminal to see if the output is as expected.

Generally, if commands work in the terminal, then we should be able to detect your client and use it.

If you are still having problems, [create an issue](https://github.com/mjcrouch/vscode-perforce/issues) for further help. If it works on the old version, then 'before and after' logs would be useful for finding the issue

## P4CONFIG Files

The main area of change is the detection of P4CONFIG files.

Perforce provides a mechanism called [P4CONFIG](https://www.perforce.com/manuals/v18.1/cmdref/Content/CmdRef/P4CONFIG.html) to help you define the perforce client, user, port etc. to use in a particular local directory.

Normally this uses a file called `.p4config` (linux / mac) or `p4config.txt` (windows) placed in the root of your client workspace

If you do not use P4CONFIG files, you can safely ignore this section (though you may find it useful in future)

### Old behaviour:
Previously, if no workspaces were found, the extension would look for a P4CONFIG file and parse its contents, looking for variables such as the `P4PORT`, `P4CLIENT` and `P4USER`

Only a maximum of one file would be found, and subsequently all perforce commands for this workspace would explicitly be run with the specific port, client and user settings parsed from the p4config

It would also read a value called `P4DIR` from this config file. This is not a standard perforce variable. When this was detected, commands within the workspace would be executed with `-d <dir value>` - overriding the PWD for perforce commands

### New behaviour

* Initialisation **never** reads or parses the *contents* of a P4CONFIG file.
* Initialisation **always** looks for P4CONFIG files, in order to find possible workspaces, **except**:
  * where the `perforce.dir` setting has been specified, OR
  * `perforce.enableP4ConfigScanOnStartup` has been turned off
* If multiple config files are found, it will attempt to create an SCM provider for each one if it is unique

### How this could affect you

* If you specified a `P4DIR` in your P4CONFIG file (extremely unlikely)
  * This is now **not supported**
  * This use case seems to be a niche within a niche, which may never have had any users - It was an undocumented feature with no obvious references in any issues. It may be possible to approximately reproduce the old behaviour by setting the `perforce.dir` setting but this has not been thoroughly tested
* If you created a file called `.p4config`, but your actual perforce environment was not set up correctly to use `.p4config` as the filename (quite unlikely)
  * Because the extension defaulted to `.p4config` as the filename, even if the P4CONFIG environment setting was not set, it would parse the file and used its contents anyway, and work with these settings. Now, since we no longer parse the contents, this case could only work by coincidence
  * This can easily be resolved by setting your P4CONFIG environment to the correct value. For example, using environment variables or p4 set
* If you have a very large workspace containing a very large number of directories, this could increase the startup time as we now scan every directory for a config file, even if we find a perforce client at the workspace root
  * This can be disabled by turning off `perforce.enableP4ConfigScanOnStartup` - obviously, this is at the expense of finding any P4CONFIG files. This can be switched per folder in a multi-root workspace
* If you had multiple p4config files and for different perforce clients in your workspace, you may see more SCM providers than you previously did in VS Code
  * This isn't a bug!

### Why this is better

* If you have multiple p4config files in your workspace, these can now be detected properly
* P4CONFIG files can include variable expansions specific to perforce, such as `$configdir` - we couldn't reasonably reproduce all of the variable expansion in the extension, and it would be a waste of effort to do so. By not reading the config file, we leave all of this parsing where it belongs, in your actual perforce client.
  * This means we can now correctly detect "Personal" perforce servers without you having to mangle the auto-generated p4config file

## `perforce.client`, `perforce.user`, `perforce.port` `perforce.password` Settings

These settings override the client, user and port on all perforce commands run within the workspace. They should generally continue to work as they did before.

There may be small differences in specific cases where a command is now run from a different working directory to before, meaning that these overrides may not be used when they were before, or they may be used when they weren't before.

This should still result in the correct behaviour, as we attempt to run commands in a directory that will definitely work - but is included here for completeness. You can check where and how commands are being applied using the perforce output log.

## `perforce.dir` Setting

This setting overrides the working directory (PWD) for all perforce commands run within the workspace. It also attempts to remove the workspace directory from the beginning of any file paths passed in to the perforce commands.

Note: If you set this item, the extension will never scan for P4CONFIG files in the workspace, because all perforce commands will effectively be run in a single working directory, so the P4CONFIG files outside of that exact working directory cannot have any effect.

This setting only has quite specific use cases, typically where the perforce client is accessed via a filesystem link within your workspace.

The behaviour of this setting *should* be the same as before, but the internal handling has changed slightly to accomodate other changes. If you do have it set, and it does not work as expected, please [create an issue](https://github.com/mjcrouch/vscode-perforce/issues) so we can understand your use-case better.
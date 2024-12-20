# BACKPORTER X-5000

Welcome one and all to the extension that will hopefully save you time and money because we all know that time is money unless you are a time lord. Backport to your hearts desire. Follow instructions or wacky things may happen such as a losing your sense of smell or your car keys, every sandwhich that you each will be bacon and lettuce but no tomoato, etc. You get the drift.

WIP: You get what you paid for; absolutely nothing, nada, zilch, zero, goose egg, bupkis, diddly-squat, and a whole lot of nothing.




## Features

- Automizes the back porting process
- Will cherry-pick a specified commit
- Will create a PR for you with assignees and reviewers.
- Will link back to the original PR in the new PR as well as any subsequent versions.



## Requirements

You will need to have the GitHub CLI tool installed and logged into your GitHub account.

## Using the extension

The extension is pretty easy to use. 

1. Open the extension in a folder that has a .git folder.
2. Choose your repository. It will be saved upon reopening of the extesion if it is a proper repository.
3. Choose your version for example release/v2.7. For each subsequent version you will need to use a comma like so, releave/v2.7, release/v2.8
4. Find the commit of a feature that has been merged and paste it. WARNING: Currently only merged commits will work.
5. Place the PR URL of the PR you wish to copy the contents of in the backported version. The refereced PR and each version specified in the backporting process will have a link at the bottom of the PR. 
6. Start backporting. 
7. Backporting will commence:
-  IF you run into no conflicts, then it will create a PR for you. You will choose an asignee and a reviewer. You can choose either a person or a team. 
- IF you run into conflicts, you will need to resolve them. Once you have resolved all conflicts press the yellowish-orange button in the status bar or press the red button if you feel like being spicy i.e. stop backporting.
8. Rinse and repeat for every version.
9. Backporting done and done. BROUGHT TO YOU BY BACKPORTER X-5000


## Known Issues

Extension may failure spectacularly if you decide to multitask during picking a reviewer/assignee. By that I mean, if you go out of focus by clicking on a dialogue or something it may cause the extension to fail. TIP: When backporting focus on backporting. This will be ironed out in the next version. Your patience is appreciated. 

If you open the extension in a non-git repository, your backport will fail before it has even started so open your local folder that has a git repository, me hearties.

## Release Notes

### 1.0.0

Working version that is still rough around the edges but can cut like a hot knife through butter.


### 1.1.0

COMING SOON


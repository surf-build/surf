# Surf: A Build Server for GitHub

Surf is a multi-platform, GitHub oriented server for building your apps continuously that is easy to set up, works on every operating system. Since Surf is built around Git and GitHub, its configuration is vastly simpler than other build servers and since it's built on node.js, installing it is really easy.

### Why would I use this over $ALTERNATIVE?

* Surf works on every platform, really easily
* Surf works even if you can't set up a WebHook (either because of GitHub privileges, firewall issues, whatever).
* Surf works inside your company firewall, without needing to carve out exceptions. As long as you can make outgoing HTTP requests, it'll work.

### Try it out by building Surf itself:

First, install Surf:

```sh
npm install -g surf-build
```

Now, try running `surf-build`, which is a command-line app that knows how to build different kinds of projects.

```sh
surf-build --repo https://github.com/surf-build/surf -s 805230d579cb49ffd7e33ee060023baebaf203e5
```

Tada! You made a build. Creating a continuous build isn't much harder - first, do the following:

1. Go to https://github.com/settings/tokens to get a token
1. Make sure to check `repo` and `gist`.
1. Generate the token and save it off

Open a Console tab and run:

```sh
export GITHUB_TOKEN='<< your token >>'
surf-server surf-build/surf
```

This is the equivalent of a Jenkins Master, but really only exists so that you won't run out of GitHub API calls per-hour.

Now, open up another tab and set up a client that will run builds for us:

```sh
export GITHUB_TOKEN='<< your token >>'
surf-client -s http://localhost:3000 -r https://github.com/surf-build/surf -- surf-build
```

That's it! Every time someone pushes a PR or change to Surf, your computer will clean-build the project. Since you (probably) don't have write permission on the Surf repo, you can't save the results to GitHub. 

## How to set up builds against GitHub PRs

Surf is great at running builds to verify your PRs, which show up here on the GitHub UI:

![](http://cl.ly/0Q0S0A233I0u/Fix_miscellaneous_Windows_bugs_by_paulcbetts__Pull_Request_7__surf-buildsurf_2016-01-27_21-51-35.png)

To set this up, all we need to do is pass `-n` to `surf-build`: 

```sh
export GITHUB_TOKEN='<< your token >>'
surf-client -s http://localhost:3000 -r https://github.com/surf-build/example-csharp -- surf-build -n 'surf-win32-x64'
```

Pass a descriptive name as your parameter to `-n`, usually the platform / architecture that you're building on. The build output will be a link on the checkmark, and posted to your account as a GitHub Gist. Check out an example: https://gist.github.com/paulcbetts/b6ab52eeb43d0c551516.

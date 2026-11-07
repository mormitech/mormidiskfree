# Windows code signing (SignPath)

Windows release builds are signed through [SignPath Foundation](https://signpath.org/), so SmartScreen stops warning
about the installer. The signed files name "SignPath Foundation" as publisher. macOS and Linux are not signed this way.

## How the build signs

`.github/workflows/build.yml`, Windows job, only on a release tag (`v*`) and only when the `SIGNPATH_API_TOKEN` secret
exists. Every other build (pull requests, pushes to main, tags while the secret is missing) skips these steps and ships
unsigned files, as before.

1. `wails build` makes `build/bin/mormidiskfree.exe`.
2. The .exe is uploaded as a GitHub artifact and sent to SignPath (artifact configuration `app`). The job waits for the
   approval, checks the signature and puts the signed .exe back in `build/bin`.
3. The zip and the Inno Setup installer are packed from the signed .exe.
4. The installer is uploaded and sent to SignPath (artifact configuration `setup`), the job waits again, checks the
   signature and replaces the installer in `dist` with the signed one.
5. The installer test and the release use the signed files. The Scoop and winget scripts take their SHA-256 from the
   files on the GitHub release, so they hash the signed files without any change.

Two signing requests, because the installer is built from the signed .exe: SignPath cannot sign the .exe inside an Inno
Setup installer after the fact. So **each release needs two approvals** in SignPath, a few minutes apart (the second
request appears once the installer is built). The Inno uninstaller (`unins000.exe`) stays unsigned; SmartScreen does not
check it.

### Approving late

The job waits up to 3 hours for the first approval and 2 hours for the second (6 hours is the most a GitHub-hosted job
may run). If an approval comes later, the step fails, the Windows job fails and the `release` job does not run, so no
release is published with unsigned files. To recover: cancel or deny the stale requests in SignPath, then in GitHub
Actions open the run and choose **Re-run failed jobs**; it builds again and sends two new requests to approve.

## Setting it up after SignPath approves the project

In SignPath (app.signpath.io, organization created by SignPath Foundation):

1. **Trusted build system**: link the predefined *GitHub.com* trusted build system to the project.
2. **Project**: slug `mormidiskfree`, repository URL `https://github.com/mormitech/mormidiskfree`.
3. **Artifact configurations** in that project, with exactly these slugs, contents from this folder:
   - `app` → [`signpath/app.xml`](signpath/app.xml)
   - `setup` → [`signpath/setup.xml`](signpath/setup.xml)
4. **Signing policy**: slug `release-signing`, the Foundation's release certificate, manual approval, approver Peter
   Jenei. Under the policy's GitHub settings, allow only tags `refs/tags/v*` of this repository if SignPath offers it.
5. **API token**: create a CI user (or use your own) with *Submitter* permission on the `release-signing` policy and make
   an API token for it.

In GitHub, repository **Settings → Secrets and variables → Actions**:

| Kind | Name | Value |
| --- | --- | --- |
| Secret | `SIGNPATH_API_TOKEN` | the API token from step 5 |
| Variable | `SIGNPATH_ORGANIZATION_ID` | the organization ID (a GUID, shown in SignPath under organization settings) |
| Variable | `SIGNPATH_PROJECT_SLUG` | optional; the workflow defaults to `mormidiskfree` |
| Variable | `SIGNPATH_SIGNING_POLICY_SLUG` | optional; the workflow defaults to `release-signing` |

Then tag a release as usual. Approve both requests in SignPath when they show up. Check on Windows that the installer's
*Properties → Digital Signatures* shows SignPath Foundation.

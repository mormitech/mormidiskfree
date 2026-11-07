# Microsoft Store package (MSIX)

Every CI build makes `mormidiskfree-<version>-windows-x64.msix` (artifact `mormidiskfree-msix`), installs it,
starts it and removes it again. The package is unsigned on purpose: the Store signs it when it is uploaded.

## One-time setup

1. In Partner Center (https://partner.microsoft.com/dashboard), reserve the name **mormiDiskFree** under
   Apps and games → New product → MSIX or PWA app.
2. Open the product's **Product identity** page and copy three values into the repository variables
   (Settings → Secrets and variables → Actions → Variables):

   | Partner Center              | Repository variable           |
   | --------------------------- | ----------------------------- |
   | Package/Identity/Name       | `MSIX_IDENTITY_NAME`          |
   | Package/Identity/Publisher  | `MSIX_PUBLISHER`              |
   | Package/Properties/PublisherDisplayName | `MSIX_PUBLISHER_DISPLAY_NAME` |

   Without them the package gets a placeholder identity, and the Store refuses it.
3. The next build (or a re-run) then makes a package the Store accepts.

## Each release

Download the `mormidiskfree-msix` artifact from the release tag's workflow run, unzip it, and upload the `.msix` in a
new submission (Packages). The Store wants each upload to carry a higher version than the last one; the version comes
from `wails.json` with `.0` appended.

The listing needs a privacy policy URL (https://mormitech.com/privacy/#mormitools), screenshots, the age-rating
questionnaire and the "runFullTrust" restricted-capability justification. For that justification: it is a desktop
disk-usage analyzer that has to read any folder the user picks and move files to the Recycle Bin.

## Local build

On Windows with the Windows SDK, after `wails build`:

    pwsh packaging\windows\msix\build-msix.ps1 -Version 0.8.2

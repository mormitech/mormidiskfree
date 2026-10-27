package main

import (
	"runtime"

	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/menu/keys"
	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// appMenu is the menu of the main window, the way each system does it. On macOS that is the application menu (About,
// Hide, Quit) plus Edit and Window. On Windows and Linux there is a Help menu with About mormiDiskFree. About opens a
// window of its own, so that it can have real links (the system's message boxes cannot).
func appMenu(app *App) *menu.Menu {
	m := menu.NewMenu()
	if runtime.GOOS == "darwin" {
		appMenu := m.AddSubmenu("mormiDiskFree")
		appMenu.AddText("About mormiDiskFree", nil, func(*menu.CallbackData) { app.showAbout() })
		appMenu.AddSeparator()
		appMenu.AddText("Hide mormiDiskFree", keys.CmdOrCtrl("h"), func(*menu.CallbackData) { wruntime.Hide(app.ctx) })
		appMenu.AddSeparator()
		appMenu.AddText("Quit mormiDiskFree", keys.CmdOrCtrl("q"), func(*menu.CallbackData) { wruntime.Quit(app.ctx) })
		m.Append(menu.EditMenu())
		m.Append(menu.WindowMenu())
		return m
	}
	help := m.AddSubmenu("Help")
	help.AddText("About mormiDiskFree", nil, func(*menu.CallbackData) { app.showAbout() })
	return m
}

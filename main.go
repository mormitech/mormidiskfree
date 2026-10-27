package main

import (
	"embed"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/menu"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
)

//go:embed all:frontend/dist
var assets embed.FS

// wails.json is the single source of the version: it ends up in the macOS Info.plist and the Windows file properties,
// and is read from here for the window title and the UI.
//
//go:embed wails.json
var projectJSON []byte

func version() string {
	var p struct {
		Info struct {
			ProductVersion string `json:"productVersion"`
		} `json:"info"`
	}
	if json.Unmarshal(projectJSON, &p) != nil || p.Info.ProductVersion == "" {
		return "dev"
	}
	return p.Info.ProductVersion
}

// startFlags reads --mock <platform> (or --mock=<platform>, or --demo): the platform of the fictional disks to show
// instead of the real ones ("" when demo mode is off), and --about: show the About window instead of the app. The app
// starts itself with --about, because Wails v2 has one window per process. Other arguments, such as the ones macOS adds
// when it launches an app, are ignored.
func startFlags(args []string) (platform string, about bool) {
	fs := flag.NewFlagSet("mormidiskfree", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	fs.StringVar(&platform, "mock", "", "show fictional disks of this platform (windows, linux or macos) instead of the real ones")
	fs.StringVar(&platform, "demo", "", "same as --mock")
	fs.BoolVar(&about, "about", false, "show the About window")
	fs.Parse(args)
	return
}

// The main window's preferred size; startup shrinks it on screens that are too small.
const windowW, windowH = 1280, 800

func main() {
	var mock *mockFS
	platform, about := startFlags(os.Args[1:])
	if platform != "" {
		var err error
		if mock, err = loadMock(platform); err != nil {
			fmt.Fprintln(os.Stderr, "mormidiskfree:", err)
			os.Exit(2)
		}
	}
	app := NewApp(mock)
	title, width, height := "mormiDiskFree v"+version(), windowW, windowH
	var menuBar *menu.Menu
	if about {
		app.mode, title, width, height = "about", "About mormiDiskFree", 440, 600
	} else { // the About window has no menu of its own
		menuBar = appMenu(app)
	}

	err := wails.Run(&options.App{
		Menu:          menuBar,
		Title:         title,
		Width:         width,
		Height:        height,
		DisableResize: about,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		// Without Mac options Wails leaves the green zoom (maximise) button disabled.
		Mac:        &mac.Options{},
		OnStartup:  app.startup,
		OnShutdown: app.shutdown,
		Bind: []interface{}{
			app,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}

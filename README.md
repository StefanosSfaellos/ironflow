# Project Time Tracker

Automatically track time spent coding on your projects and sync with your project management system.

## Features

- Automatic time tracking when you're actively coding
- Syncs with your project management system
- Idle detection (stops tracking after 5 minutes of inactivity)
- Project-specific time tracking
- Easy to enable/disable tracking

## Setup

1. Install the extension
2. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac) to open the Command Palette
3. Configure the extension:
   - Run `Time Tracker: Set API URL` to set your API endpoint
   - Run `Time Tracker: Set Project ID` to set your project
4. Start tracking:
   - Run `Time Tracker: Toggle Time Tracking` to start/stop tracking

## Commands

- `Time Tracker: Set API URL` - Configure the API endpoint
- `Time Tracker: Set Project ID` - Set the current project ID
- `Time Tracker: Toggle Time Tracking` - Enable/disable automatic time tracking

## Requirements

- VS Code 1.60.0 or newer
- Active internet connection to sync with API

## Extension Settings

This extension contributes the following settings:

* `timeTracker.apiUrl`: API endpoint URL
* `timeTracker.projectId`: Current project ID
* `timeTracker.idleTimeout`: Idle detection timeout (default: 5 minutes)

## Known Issues

None at this time.

## Release Notes

### 1.0.0

Initial release of Project Time Tracker:
- Automatic time tracking
- Project-specific tracking
- Idle detection
- API synchronization

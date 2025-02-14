// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import axios from 'axios';
import * as path from 'path';

let lastActivity: number = 0;
let isTracking: boolean = false;
let currentSession: { startTime: number; projectId: string } | null = null;
const IDLE_TIMEOUT = 300000; // 5 minutes in milliseconds
let statusBarItem: vscode.StatusBarItem;
let statusBarUpdateInterval: NodeJS.Timer | null = null;

// Add these interfaces at the top
interface Project {
	projectdomn: string;
	projectname: string;
	projecttype: string;
}

// Update the interface
interface ProjectResponse {
	success: boolean;
	data?: Project[];
	message?: string;
}

// Add this at the top of the file after imports
const axiosInstance = axios.create({
	headers: {
		'Content-Type': 'application/json',
		'Accept': 'application/json'
	}
});

// Add this class before the activate function
class TimeTrackerProvider implements vscode.TreeDataProvider<TimeTrackerItem> {
	private _onDidChangeTreeData: vscode.EventEmitter<TimeTrackerItem | undefined | null | void> = new vscode.EventEmitter<TimeTrackerItem | undefined | null | void>();
	readonly onDidChangeTreeData: vscode.Event<TimeTrackerItem | undefined | null | void> = this._onDidChangeTreeData.event;

	refresh(): void {
		this._onDidChangeTreeData.fire();
	}

	getTreeItem(element: TimeTrackerItem): vscode.TreeItem {
		return element;
	}

	async getChildren(element?: TimeTrackerItem): Promise<TimeTrackerItem[]> {
		if (element) {
			return [];
		}

		const items: TimeTrackerItem[] = [];

		// Status item
		items.push(new TimeTrackerItem(
			'Status',
			isTracking ? 'Active' : 'Inactive',
			vscode.TreeItemCollapsibleState.None,
			{
				command: 'ironflow.toggle',
				title: 'Toggle Tracking'
			}
		));

		// Project item with command to change project
		const projectId = vscode.workspace.getConfiguration('ironflow').get('projectId');
		const projectName = await this.getProjectName(projectId as string);
		items.push(new TimeTrackerItem(
			'Project',
			projectName || projectId?.toString() || 'Not set',
			vscode.TreeItemCollapsibleState.None,
			{
				command: 'ironflow.selectProject',
				title: 'Select Project'
			}
		));

		// Session duration
		if (currentSession) {
			const duration = Math.floor((Date.now() - currentSession.startTime) / 1000 / 60);
			items.push(new TimeTrackerItem(
				'Current Session',
				`${duration} minutes`,
				vscode.TreeItemCollapsibleState.None
			));
		}

		return items;
	}

	private async getProjectName(projectId: string): Promise<string> {
		if (!projectId) return '';
		
		const apiUrl = vscode.workspace.getConfiguration('ironflow').get('apiUrl') as string;
		const authToken = vscode.workspace.getConfiguration('ironflow').get('authToken');

		try {
			// Debug headers
			console.log('Sending headers:', {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${authToken}`
			});

			const response = await axiosInstance.get<ProjectResponse>(`${apiUrl}/get_projects.php`, {
				headers: {
					'Authorization': `Bearer ${authToken}`
				}
			});

			if (response.data.success && response.data.data) {
				const project = response.data.data.find((p: Project) => p.projectdomn === projectId);
				return project ? `${project.projectname} (${project.projecttype})` : projectId;
			}
			return projectId;
		} catch (error) {
			return projectId;
		}
	}
}

class TimeTrackerItem extends vscode.TreeItem {
	constructor(
		public readonly label: string,
		private value: string,
		public readonly collapsibleState: vscode.TreeItemCollapsibleState,
		public readonly command?: vscode.Command
	) {
		super(label, collapsibleState);
		this.tooltip = `${label}: ${value}`;
		this.description = value;
	}
}

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {
	console.log('Project Time Tracker is now active');

	// Create and register the tree data provider
	const timeTrackerProvider = new TimeTrackerProvider();
	vscode.window.registerTreeDataProvider('timeTrackerView', timeTrackerProvider);

	// Create status bar item
	statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
	statusBarItem.command = 'ironflow.toggle';
	statusBarItem.text = "$(watch) 00:00:00";
	statusBarItem.tooltip = "Time Tracker";
	updateStatusBar();
	statusBarItem.show();
	context.subscriptions.push(statusBarItem);

	// Add command to enable/disable automatic tracking
	let toggleCommand = vscode.commands.registerCommand('ironflow.toggle', async () => {
		if (!isTracking) {
			// Check if we have all required settings before starting
			const projectId = vscode.workspace.getConfiguration('ironflow').get('projectId');
			const apiUrl = vscode.workspace.getConfiguration('ironflow').get('apiUrl');
			const authToken = vscode.workspace.getConfiguration('ironflow').get('authToken');

			if (!apiUrl || !authToken) {
				vscode.window.showWarningMessage('Please configure API URL and Auth Token first');
				return;
			}

			if (!projectId) {
				vscode.window.showWarningMessage('Please select a project first', 'Select Project')
					.then(selection => {
						if (selection === 'Select Project') {
							vscode.commands.executeCommand('ironflow.selectProject');
						}
					});
				return;
			}

			// Set current session when starting
			currentSession = {
				startTime: Date.now(),
				projectId: projectId as string
			};
			
			isTracking = true;
			updateStatusBar();
			
			// Start interval to update status bar every second
			if (statusBarUpdateInterval) {
				clearInterval(statusBarUpdateInterval);
			}
			statusBarUpdateInterval = setInterval(() => {
				updateStatusBar();
			}, 1000);
			
			// Start tracking on server
			await startTracking();
			
		} else {
			isTracking = false;
			
			// Clear the update interval
			if (statusBarUpdateInterval) {
				clearInterval(statusBarUpdateInterval);
				statusBarUpdateInterval = null;
			}
			
			updateStatusBar();
			if (currentSession) {
				await stopTracking();
				currentSession = null;  // Clear current session
			}
		}
		
		timeTrackerProvider.refresh();
	});

	// Add command to set project ID
	let setProjectCommand = vscode.commands.registerCommand('ironflow.setProject', async () => {
		const projectId = await vscode.window.showInputBox({
			prompt: 'Enter your project ID',
			placeHolder: 'Project ID from the web application'
		});

		if (projectId) {
			await vscode.workspace.getConfiguration().update('ironflow.projectId', projectId, true);
			vscode.window.showInformationMessage(`Project ID set to: ${projectId}`);
		}
	});

	// Add command to set API URL
	let setApiUrlCommand = vscode.commands.registerCommand('ironflow.setApiUrl', async () => {
		const apiUrl = await vscode.window.showInputBox({
			prompt: 'Enter the API URL',
			placeHolder: 'https://your-domain.com/src/time_tracker'
		});

		if (apiUrl) {
			await vscode.workspace.getConfiguration().update('ironflow.apiUrl', apiUrl, true);
			vscode.window.showInformationMessage(`API URL set to: ${apiUrl}`);
		}
	});

	// Add command to set authentication token
	let setAuthTokenCommand = vscode.commands.registerCommand('ironflow.setAuthToken', async () => {
		const authToken = await vscode.window.showInputBox({
			prompt: 'Enter your authentication token',
			placeHolder: 'Your auth_token from the web application'
		});

		if (authToken) {
			await vscode.workspace.getConfiguration().update('ironflow.authToken', authToken, true);
			vscode.window.showInformationMessage('Authentication token set');
		}
	});

	// Add refresh command
	let refreshCommand = vscode.commands.registerCommand('ironflow.refresh', () => {
		timeTrackerProvider.refresh();
	});

	// Add the new command
	let selectProjectCommand = vscode.commands.registerCommand('ironflow.selectProject', async () => {
		const apiUrl = vscode.workspace.getConfiguration('ironflow').get('apiUrl') as string;
		const authToken = vscode.workspace.getConfiguration('ironflow').get('authToken');

		// Debug settings
		vscode.window.showInformationMessage(`Debug - Project Fetch:
			API URL: ${apiUrl}
			Auth Token: ${authToken ? 'Present' : 'Missing'}`);

		try {
			const headers = {
				'Authorization': `Bearer ${authToken}`
			};
			
			// Debug headers
			vscode.window.showInformationMessage(`Sending headers: ${JSON.stringify(headers)}`);

			const response = await axiosInstance.get<ProjectResponse>(`${apiUrl}/get_projects.php`, {
				headers: headers
			});

			// Debug response
			vscode.window.showInformationMessage(`Project response: ${JSON.stringify(response.data, null, 2)}`);

			if (!response.data.success || !response.data.data) {
				throw new Error(response.data.message || 'Failed to fetch projects');
			}

			const projects = response.data.data;
			if (projects.length === 0) {
				vscode.window.showInformationMessage('No projects found for your account');
				return;
			}

			const items = projects.map(p => ({
				label: p.projectname,
				description: p.projecttype,
				projectId: p.projectdomn
			}));

			const selected = await vscode.window.showQuickPick(items, {
				placeHolder: 'Select a project'
			});

			if (selected) {
				await vscode.workspace.getConfiguration().update('ironflow.projectId', selected.projectId, true);
				vscode.window.showInformationMessage(`Project set to: ${selected.label}`);
				timeTrackerProvider.refresh();
			}
		} catch (error: any) {
			const errorMessage = error.response?.data?.message || error.message;
			const errorDetails = error.response?.data || {};
			vscode.window.showErrorMessage(`Failed to fetch projects:
				Error: ${errorMessage}
				Details: ${JSON.stringify(errorDetails, null, 2)}
				Status: ${error.response?.status || 'Unknown'}
				Headers: ${JSON.stringify(error.response?.headers || {}, null, 2)}
				Auth Token Used: ${authToken}`);
		}
	});

	context.subscriptions.push(toggleCommand, setProjectCommand, setApiUrlCommand, setAuthTokenCommand, refreshCommand, selectProjectCommand);

	// Track editor activity
	vscode.workspace.onDidChangeTextDocument(() => handleActivity());
	vscode.window.onDidChangeActiveTextEditor(() => handleActivity());

	// Set up a timer to refresh the view periodically when tracking
	setInterval(() => {
		if (isTracking && currentSession) {
			timeTrackerProvider.refresh();
		}
	}, 60000); // Refresh every minute
}

function updateStatusBar() {
	if (isTracking && currentSession) {
		const duration = Math.floor((Date.now() - currentSession.startTime) / 1000);
		const hours = Math.floor(duration / 3600);
		const minutes = Math.floor((duration % 3600) / 60);
		const seconds = duration % 60;
		const timeString = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
		
		statusBarItem.text = `$(watch) ${timeString}`;
		statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
		statusBarItem.tooltip = 'Time Tracker (Click to Stop)';
	} else {
		statusBarItem.text = "$(watch) 00:00:00";
		statusBarItem.backgroundColor = undefined;
		statusBarItem.tooltip = 'Time Tracker (Click to Start)';
	}
}

async function handleActivity() {
	if (!isTracking) return;

	const projectId = vscode.workspace.getConfiguration('ironflow').get('projectId');
	if (!projectId) {
		isTracking = false;
		updateStatusBar();
		vscode.window.showWarningMessage('Please select a project before starting time tracking');
		return;
	}

	const now = Date.now();
	
	// If this is the first activity or we're coming back from idle
	if (!currentSession && (!lastActivity || (now - lastActivity) > IDLE_TIMEOUT)) {
		await startTracking();
	}
	
	lastActivity = now;

	// Check for idle timeout
	setTimeout(() => checkIdle(), IDLE_TIMEOUT);
}

async function startTracking() {
	const apiUrl = vscode.workspace.getConfiguration('ironflow').get('apiUrl') as string;
	const authToken = vscode.workspace.getConfiguration('ironflow').get('authToken');
	const projectId = vscode.workspace.getConfiguration('ironflow').get('projectId');

	if (!projectId) {
		vscode.window.showErrorMessage('Please select a project first');
		return;
	}

	try {
		// Debug request details
		const requestData = {
			projectdomn: projectId,
			start_time: Date.now()
		};
		
		vscode.window.showInformationMessage(`Starting timer with: ${JSON.stringify({
			url: `${apiUrl}/start_timer.php`,
			data: requestData,
			headers: {
				'Authorization': `Bearer ${authToken}`
			}
		}, null, 2)}`);

		const response = await axios.post(`${apiUrl}/start_timer.php`, requestData, {
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${authToken}`
			}
		});

		// Show full response for debugging
		vscode.window.showInformationMessage(`Start timer response: ${JSON.stringify(response.data, null, 2)}`);

		if (response.data.success) {
			currentSession = {
				startTime: Date.now(),
				projectId: projectId as string
			};
			vscode.window.showInformationMessage(`Time tracking started successfully at ${new Date().toLocaleString()}`);
		} else {
			throw new Error(response.data.message || 'Failed to start tracking');
		}
	} catch (error: any) {
		const errorDetails = {
			message: error.message,
			response: error.response?.data,
			status: error.response?.status,
			headers: error.response?.headers
		};
		vscode.window.showErrorMessage(`Start tracking error: ${JSON.stringify(errorDetails, null, 2)}`);
	}
}

async function stopTracking() {
	if (!currentSession) {
		vscode.window.showWarningMessage('No active tracking session to stop');
		return;
	}

	const apiUrl = vscode.workspace.getConfiguration('ironflow').get('apiUrl') as string;
	const authToken = vscode.workspace.getConfiguration('ironflow').get('authToken');

	try {
		// Debug request details
		const requestData = {
			projectdomn: currentSession.projectId,
			end_time: Date.now()
		};

		vscode.window.showInformationMessage(`Stopping timer with: ${JSON.stringify({
			url: `${apiUrl}/stop_timer.php`,
			data: requestData,
			headers: {
				'Authorization': `Bearer ${authToken}`
			}
		}, null, 2)}`);

		const response = await axios.post(`${apiUrl}/stop_timer.php`, requestData, {
			headers: {
				'Content-Type': 'application/json',
				'Authorization': `Bearer ${authToken}`
			}
		});

		// Show full response for debugging
		vscode.window.showInformationMessage(`Stop timer response: ${JSON.stringify(response.data, null, 2)}`);

		if (response.data.success) {
			currentSession = null;
			vscode.window.showInformationMessage('Time tracking stopped successfully');
		} else {
			throw new Error(response.data.message || 'Failed to stop tracking');
		}
	} catch (error: any) {
		const errorDetails = {
			message: error.message,
			response: error.response?.data,
			status: error.response?.status,
			headers: error.response?.headers
		};
		vscode.window.showErrorMessage(`Stop tracking error: ${JSON.stringify(errorDetails, null, 2)}`);
	}
}

async function checkIdle() {
	const now = Date.now();
	if (currentSession && (now - lastActivity) > IDLE_TIMEOUT) {
		await stopTracking();
	}
}

// This method is called when your extension is deactivated
export function deactivate() {
	if (currentSession) {
		stopTracking();
	}
	if (statusBarUpdateInterval) {
		clearInterval(statusBarUpdateInterval);
	}
	if (statusBarItem) {
		statusBarItem.dispose();
	}
}

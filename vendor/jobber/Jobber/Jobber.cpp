// Jobber.cpp : Defines the entry point for the application.
//

#include "stdafx.h"
#include "Jobber.h"

int APIENTRY wWinMain(_In_ HINSTANCE hInstance,
                     _In_opt_ HINSTANCE hPrevInstance,
                     _In_ LPWSTR    lpCmdLine,
                     _In_ int       nCmdShow)
{
	AttachConsole(ATTACH_PARENT_PROCESS);

	// Create a named pipe that we can be signaled on for early termination
	wchar_t buf[512];
	wsprintf(buf, L"\\\\.\\pipe\\jobber-%d", GetCurrentProcessId());

	HANDLE hPipe = CreateNamedPipe(buf, 
		PIPE_ACCESS_INBOUND | FILE_FLAG_OVERLAPPED, 
		PIPE_READMODE_BYTE | PIPE_WAIT, 
		1, 256, 256, 100000, NULL);

	OVERLAPPED io = { 0 };
	io.hEvent = CreateEvent(NULL, true, true, NULL);
	if (!ConnectNamedPipe(hPipe, &io) && GetLastError() != ERROR_IO_PENDING) {
		DWORD dwLastError = GetLastError();
		return -1;
	}

	STARTUPINFO si = { 0 };
	PROCESS_INFORMATION pi = { 0 };
	si.cb = sizeof(STARTUPINFO);
	si.wShowWindow = nCmdShow;

	if (!CreateProcess(NULL, lpCmdLine, NULL, NULL, true, CREATE_SUSPENDED, NULL, NULL, &si, &pi)) {
		DWORD dwLastError = GetLastError();
		return -1;
	}

	HANDLE hJob = CreateJobObject(NULL, NULL);
	AssignProcessToJobObject(hJob, pi.hProcess);

	ResumeThread(pi.hThread);

	HANDLE handles[2];
	handles[0] = io.hEvent;
	handles[1] = pi.hProcess;

	int result = WaitForMultipleObjects(2, handles, false, INFINITE);
	TerminateJobObject(hJob, -1);

	if (result == WAIT_OBJECT_0) {
		return -1;
	} else {
		DWORD dwExit;

		GetExitCodeProcess(pi.hProcess, &dwExit);
		return dwExit;
	}

}
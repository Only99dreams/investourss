@echo off
rem Run the statement audit with the portable Python in tools\pyenv.
"%~dp0pyenv\python.exe" "%~dp0audit_statement.py" %*

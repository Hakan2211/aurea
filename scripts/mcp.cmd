@echo off
rem Aurea MCP server launcher: runs from the repo root so the tsx import resolves
rem from any working directory. Register: claude mcp add --scope user aurea -- "%~f0"
cd /d "%~dp0.."
node --import tsx packages\core\src\mcp.ts

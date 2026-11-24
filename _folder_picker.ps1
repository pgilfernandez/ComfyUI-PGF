$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms

$owner = New-Object System.Windows.Forms.Form
$owner.TopMost = $true
$owner.ShowInTaskbar = $false
$owner.FormBorderStyle = 'None'
$owner.Size = [System.Drawing.Size]::new(1, 1)
$owner.Opacity = 0
$owner.StartPosition = 'CenterScreen'

$start = $env:PGF_FOLDER_PICKER_START
$save = $env:PGF_PICKER_KIND -eq 'save'
$pickFile = $env:PGF_PICKER_KIND -in @('file', 'read', 'save')
if ($pickFile) {
    if ($save) {
        $picker = New-Object System.Windows.Forms.SaveFileDialog
        $picker.Title = 'Save text file'
        $picker.OverwritePrompt = $true
        $picker.DefaultExt = 'txt'
    } else {
        $picker = New-Object System.Windows.Forms.OpenFileDialog
        $picker.Title = 'Open text file'
        $picker.CheckFileExists = $true
    }
    $picker.Filter = 'Text files (*.txt)|*.txt'
    if ($start -and [IO.File]::Exists($start)) {
        $picker.InitialDirectory = [IO.Path]::GetDirectoryName($start)
        $picker.FileName = [IO.Path]::GetFileName($start)
    }
} else {
    $picker = New-Object System.Windows.Forms.FolderBrowserDialog
    $picker.Description = 'Choose a folder for PGF - Load Text Files'
    $picker.ShowNewFolderButton = $false
    if ($start -and [IO.Path]::IsPathRooted($start) -and [IO.Directory]::Exists($start)) {
        $picker.SelectedPath = $start
    }
}

$owner.Add_Shown({
    try {
        $owner.Activate()
        if ($picker.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
            if ($pickFile) {
                [Console]::Out.Write($picker.FileName)
            } else {
                [Console]::Out.Write($picker.SelectedPath)
            }
        }
    } finally {
        $owner.Close()
    }
})
try {
    [void]$owner.ShowDialog()
} finally {
    $picker.Dispose()
    $owner.Dispose()
}

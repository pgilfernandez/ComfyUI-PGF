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

$picker = New-Object System.Windows.Forms.FolderBrowserDialog
$picker.Description = 'Choose a folder for PGF - Load Text Files'
$picker.ShowNewFolderButton = $false
$start = $env:PGF_FOLDER_PICKER_START
if ($start -and [IO.Path]::IsPathRooted($start) -and [IO.Directory]::Exists($start)) {
    $picker.SelectedPath = $start
}

$owner.Add_Shown({
    try {
        $owner.Activate()
        if ($picker.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
            [Console]::Out.Write($picker.SelectedPath)
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

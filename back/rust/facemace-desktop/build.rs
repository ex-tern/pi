// On Windows: the Face Mace icon and the program's name, version and maker, put into FaceMace.exe (as Explorer and the
// installer show them). Elsewhere nothing is done.
fn main() {
    println!("cargo:rerun-if-changed=assets/facemace.ico");
    #[cfg(windows)]
    {
        let mut r = winresource::WindowsResource::new();
        r.set_icon("assets/facemace.ico");
        r.set("ProductName", "Face Mace");
        r.set("FileDescription", "Face Mace: sorts photos and videos by face, on this computer");
        r.set("CompanyName", "Pi Tech Lab");
        r.set("LegalCopyright", "Pi Tech Lab");
        if let Err(e) = r.compile() {
            println!("cargo:warning=the icon could not be added: {}", e);
        }
    }
}

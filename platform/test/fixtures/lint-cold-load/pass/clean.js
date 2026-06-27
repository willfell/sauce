class Clean {
  render(dv) {
    const page = customJS.RenderSafe.page(dv);
    if (!page || !page.file) return;
    const name = page.file.name;
    const path2 = dv.current()?.file?.path; // optional-chain is allowed
    return [name, path2];
  }
}

class Bad {
  render(dv) {
    const name = dv.current().file.name;   // R1 violation
    return name;
  }
}

{
  pkgs ? import <nixpkgs> { },
  version ? "dev",
  commit ? "unknown",
  # Accepts a bool or the string "false" (from `nix-build --argstr`), so image
  # builds that already ran tests elsewhere can skip the checkPhase, which
  # recompiles every dependency without -trimpath.
  doCheck ? true,
  # Opt-in persistent Go build cache (e.g. a PVC in CI). Impure: it only works
  # with `sandbox = false`, and the directory must be writable by the Nix build
  # users. Go's cache is content-addressed and -trimpath keeps build paths out
  # of its keys, so reusing it does not change the output. Empty disables it.
  goCacheDir ? "",
}:
let
  inherit (pkgs.lib) cleanSource cleanSourceWith;
in
pkgs.buildGoModule {
  pname = "chihiro";
  version = "${version}";

  src = cleanSourceWith {
    filter =
      name: _:
      !(
        (baseNameOf name) == "Dockerfile"
        || (baseNameOf name) == "Makefile"
        || (baseNameOf name) == "README.md"
        || (baseNameOf name) == "PROJECT"
        || (baseNameOf name) == "config"
        || (baseNameOf name) == "conf"
        || (baseNameOf name) == "nix"
      );
    src = cleanSource ../.;
  };
  ldflags = [
    "-s"
    "-w"
    "-X github.com/Bealvio/chihiro/cmd.Version=${version}"
    "-X github.com/Bealvio/chihiro/cmd.Commit=${commit}"
  ];

  vendorHash = "sha256-K7ntN3P4m7IdkY+ONSIyFZiC2tLf1p5p9Hp7T5zfykc=";
  # Keep the go-modules store path independent of `version`: it is a
  # fixed-output derivation, so a stable name lets a binary cache serve it
  # instead of re-downloading every module on each commit.
  # preBuild is reset so the GOCACHE hook below stays out of this FOD.
  overrideModAttrs = _: _: {
    name = "chihiro-go-modules";
    preBuild = "";
  };

  doCheck = doCheck == true || doCheck == "true";

  # buildGoModule points GOCACHE at $TMPDIR in configurePhase; override it
  # afterwards. umask 000 so entries written by one nixbld user can be
  # replaced or trimmed by another on a later run; it is restored in
  # postBuild, since Nix rejects world-writable outputs.
  preBuild = pkgs.lib.optionalString (goCacheDir != "") ''
    umask 000
    mkdir -p ${goCacheDir}
    export GOCACHE=${goCacheDir}
  '';
  postBuild = pkgs.lib.optionalString (goCacheDir != "") ''
    umask 022
  '';

  meta = with pkgs.lib; {
    description = "$pname; version: $version";
    homepage = "http://github.com/banh-canh/$pname";
    license = licenses.asl20;
    platforms = platforms.linux;
    mainProgram = "$pname";
  };
}

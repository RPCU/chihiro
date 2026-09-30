{
  pkgs ? import <nixpkgs> { },
  dockerVersion ? "0.0.0",
  commit ? "unknown",
  doCheck ? true,
  goCacheDir ? "",
  imageName ? "zot.rpcu.io/public/chihiro",
}:
let
  binaries = pkgs.callPackage ./binaries.nix {
    version = dockerVersion;
    inherit commit doCheck goCacheDir;
  };
  webAssets = pkgs.runCommand "chihiro-web-assets" { } ''
    mkdir -p $out/web
    cp -r ${../web}/* $out/web/
  '';
  makeDummyImage = {
    fakeRootCommands = ''
      ln -s var/run run
      ln -s bin/${binaries.pname} chihiro
      mkdir -p web
      cp -r ${webAssets}/web/* web/
    '';
    name = "${imageName}";
    contents = [
      binaries
      pkgs.dockerTools.caCertificates
      pkgs.openssl
      pkgs.cacert
      (pkgs.dockerTools.fakeNss.override {
        extraPasswdLines = [
          "nixbld:x:${toString 1001}:${toString 0}:Build user:/home/${binaries.pname}:/noshell"
        ];
        extraGroupLines = [ "nixbld:!:${toString 1001}:" ];
      })
    ];

    config = {
      User = "1001:0";
      Entrypoint = [ "/chihiro" ];
      # Default to serving with the config at /config.yaml, so runtimes that
      # only set the image (e.g. OpenChoreo workloads, which cannot set args)
      # start the server instead of printing usage and exiting. Deployments
      # that pass their own command/args are unaffected.
      Cmd = [
        "serve"
        "--config=/config.yaml"
      ];
      Env = [
        "NIX_SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
        "SSL_CERT_FILE=${pkgs.cacert}/etc/ssl/certs/ca-bundle.crt"
      ];
    };
  };
  imageDummy = pkgs.dockerTools.streamLayeredImage {
    inherit (makeDummyImage) fakeRootCommands;
    inherit (makeDummyImage) name;
    inherit (makeDummyImage) contents;
    inherit (makeDummyImage) config;
    tag = "${dockerVersion}";
  };
in
pkgs.dockerTools.streamLayeredImage {
  inherit (makeDummyImage) fakeRootCommands;
  tag = imageDummy.imageTag;
  inherit (makeDummyImage) name;
  inherit (makeDummyImage) contents;
  inherit (makeDummyImage) config;
}

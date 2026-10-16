import { describe, expect, it } from "vitest";
import { isPrivateHost, privateOrigin } from "../src/upstream.js";

describe("upstream address", () => {
  it("allows loopback and private hosts", () => {
    expect(privateOrigin("http://localhost:11434/v1")).toBe("http://localhost:11434");
    expect(privateOrigin("http://127.0.0.1:11434")).toBe("http://127.0.0.1:11434");
    expect(privateOrigin("http://192.168.1.8:8188")).toBe("http://192.168.1.8:8188");
    expect(privateOrigin("http://10.1.2.3:11434")).toBe("http://10.1.2.3:11434");
    expect(privateOrigin("http://172.16.5.4")).toBe("http://172.16.5.4");
    expect(privateOrigin("http://[::1]:11434")).toBe("http://[::1]:11434");
    expect(isPrivateHost("host.docker.internal")).toBe(true);
  });

  it("rejects public hosts, credentials, and other protocols", () => {
    expect(() => privateOrigin("http://8.8.8.8:11434")).toThrow(/局域网/);
    expect(() => privateOrigin("http://172.32.0.1")).toThrow(/局域网/);
    expect(() => privateOrigin("http://example.com")).toThrow(/局域网/);
    expect(() => privateOrigin("ftp://127.0.0.1")).toThrow(/http/);
    expect(() => privateOrigin("http://user:pass@127.0.0.1")).toThrow(/账号密码/);
    expect(() => privateOrigin("not a url")).toThrow(/URL/);
  });
});

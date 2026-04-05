import { describe, it, expect } from 'vitest';
import { classifyCommand } from './commandClassifier';

describe('commandClassifier', () => {
    // ── Helper ──
    const expectSafe = (cmd: string, custom?: string[]) => {
        const result = classifyCommand(cmd, custom);
        expect(result.safe, `Expected "${cmd}" to be safe, but got: ${result.reason}`).toBe(true);
    };
    const expectUnsafe = (cmd: string, custom?: string[]) => {
        const result = classifyCommand(cmd, custom);
        expect(result.safe, `Expected "${cmd}" to be unsafe`).toBe(false);
    };

    // ── Empty / whitespace ──
    describe('empty commands', () => {
        it('rejects empty string', () => expectUnsafe(''));
        it('rejects whitespace', () => expectUnsafe('   '));
    });

    // ── Basic safe commands ──
    describe('basic safe commands', () => {
        it.each([
            'ls', 'ls -la', 'ls -la /tmp',
            'cat /etc/hosts',
            'head -n 20 file.txt',
            'tail -f /var/log/syslog',
            'grep error /var/log/syslog',
            'find . -name "*.log"',
            'pwd',
            'whoami',
            'date',
            'hostname',
            'df -h',
            'du -sh /tmp',
            'ps aux',
            'uname -a',
            'echo "hello"',
            'ping 192.168.1.1',
            'traceroute 8.8.8.8',
            'dig google.com',
            'nslookup example.com',
            'ip addr',
            'ifconfig eth0',
            'netstat -tlnp',
            'ss -tlnp',
            'curl https://example.com',
            'wget -q -O - https://example.com',
            'git status',
            'git log --oneline',
            'git diff',
            'git branch -a',
            'git remote -v',
            'git show HEAD',
            'git tag -l',
            'history',
            'env',
            'printenv PATH',
            'free -h',
            'uptime',
            'wc -l file.txt',
            'stat file.txt',
            'file /bin/bash',
            'man ls',
        ])('classifies "%s" as safe', (cmd) => expectSafe(cmd));
    });

    // ── Basic unsafe commands ──
    describe('basic unsafe commands', () => {
        it.each([
            'rm -rf /',
            'rm file.txt',
            'mv file1 file2',
            'cp file1 file2',
            'chmod 777 file',
            'chown root:root file',
            'dd if=/dev/zero of=/dev/sda',
            'mkfs.ext4 /dev/sda1',
            'shutdown -h now',
            'reboot',
            'kill -9 1234',
            'pkill nginx',
            'mkdir /tmp/test',
            'touch newfile',
            'nano file.txt',
            'vim file.txt',
            'python script.py',
            'node script.js',
        ])('classifies "%s" as unsafe', (cmd) => expectUnsafe(cmd));
    });

    // ── Danger patterns ──
    describe('danger patterns', () => {
        it('rejects output redirection >', () => {
            expectUnsafe('echo "data" > file.txt');
        });
        it('rejects append redirection >>', () => {
            expectUnsafe('echo "data" >> file.txt');
        });
        it('rejects input redirection <', () => {
            expectUnsafe('wc -l < file.txt');
        });
        it('rejects command substitution $()', () => {
            expectUnsafe('echo $(whoami)');
        });
        it('rejects command substitution backticks', () => {
            expectUnsafe('echo `whoami`');
        });
        it('rejects semicolon chaining', () => {
            expectUnsafe('ls; rm file');
        });
        it('rejects && chaining', () => {
            expectUnsafe('ls -la && rm file');
        });
        it('rejects || chaining', () => {
            expectUnsafe('ls || echo fallback');
        });
        it('rejects sudo', () => {
            expectUnsafe('sudo ls');
        });
        it('rejects su', () => {
            expectUnsafe('su - root');
        });
        it('rejects doas', () => {
            expectUnsafe('doas ls');
        });
    });

    // ── Pipe handling ──
    describe('pipe handling', () => {
        it('allows safe | safe', () => {
            expectSafe('cat file.txt | grep error');
        });
        it('allows multi-pipe all safe', () => {
            expectSafe('cat file.txt | grep error | wc -l');
        });
        it('rejects safe | unsafe', () => {
            expectUnsafe('cat file.txt | tee output.txt');
        });
        it('rejects unsafe | safe', () => {
            expectUnsafe('python script.py | grep result');
        });
    });

    // ── Cisco IOS ──
    describe('Cisco IOS commands', () => {
        it.each([
            'show version',
            'show ip route',
            'show ip interface brief',
            'show running-config',
            'show interfaces GigabitEthernet0/0',
            'show ip bgp summary',
            'show ip ospf neighbor',
            'show cdp neighbors detail',
            'show mac address-table',
            'show vlan brief',
            'show spanning-tree',
            'show access-lists',
            'show logging',
            'show environment',
            'show processes cpu',
            'show clock',
            'show inventory',
            'show ip arp',
            'show crypto isakmp sa',
        ])('classifies "%s" as safe', (cmd) => expectSafe(cmd));

        it('allows show with | include filter', () => {
            expectSafe('show ip route | include 192.168');
        });
        it('allows show with | exclude filter', () => {
            expectSafe('show running-config | exclude !');
        });
        it('allows show with | begin filter', () => {
            expectSafe('show running-config | begin interface');
        });
        it('allows show with | section filter', () => {
            expectSafe('show running-config | section router');
        });
        it('allows show with | count filter', () => {
            expectSafe('show ip route | count');
        });

        // Cisco pipe redirect/append/tee → unsafe (not in whitelist)
        it('rejects show with | redirect', () => {
            expectUnsafe('show running-config | redirect flash:config.txt');
        });
        it('rejects show with | append', () => {
            expectUnsafe('show tech-support | append flash:tech.txt');
        });
        it('rejects show with | tee', () => {
            expectUnsafe('show version | tee flash:version.txt');
        });
    });

    // ── Huawei VRP ──
    describe('Huawei VRP commands', () => {
        it.each([
            'display version',
            'display ip routing-table',
            'display interface brief',
            'display current-configuration',
            'display arp',
            'display mac-address',
            'display vlan',
            'display stp',
            'display bgp peer',
            'display ospf peer',
            'display acl all',
            'display logbuffer',
            'display cpu-usage',
            'display memory-usage',
            'display clock',
            'display device',
        ])('classifies "%s" as safe', (cmd) => expectSafe(cmd));

        it('allows display with | include filter', () => {
            expectSafe('display ip routing-table | include 10.0.0');
        });
        it('allows display with | exclude filter', () => {
            expectSafe('display current-configuration | exclude #');
        });
        it('allows display with | begin filter', () => {
            expectSafe('display current-configuration | begin interface');
        });
        it('allows display with | count filter', () => {
            expectSafe('display arp | count');
        });
    });

    // ── Juniper Junos ──
    describe('Juniper Junos commands', () => {
        it('allows show with | match', () => {
            expectSafe('show route | match 192.168');
        });
        it('allows show with | except', () => {
            expectSafe('show interfaces | except down');
        });
        it('allows show with | no-more', () => {
            expectSafe('show configuration | no-more');
        });
        it('allows show with | count', () => {
            expectSafe('show route | count');
        });
        it('allows show with | last', () => {
            expectSafe('show log messages | last 50');
        });
    });

    // ── Palo Alto / FortiGate ──
    describe('Palo Alto / FortiGate commands', () => {
        it('allows get commands', () => {
            expectSafe('get system info');
        });
        it('allows diagnose commands', () => {
            expectSafe('diagnose system session stat');
        });
    });

    // ── Network device config commands (should be unsafe) ──
    describe('network device unsafe commands', () => {
        it.each([
            'configure terminal',
            'conf t',
            'system-view',
            'undo interface GigabitEthernet0/0',
            'no ip route 0.0.0.0 0.0.0.0',
            'write memory',
            'copy running-config startup-config',
            'reload',
            'clear ip bgp *',
            'debug ip routing',
        ])('classifies "%s" as unsafe', (cmd) => expectUnsafe(cmd));
    });

    // ── Dangerous flags on whitelisted commands ──
    describe('dangerous flags', () => {
        it('rejects find -delete', () => {
            expectUnsafe('find /tmp -name "*.log" -delete');
        });
        it('rejects find -exec', () => {
            expectUnsafe('find . -name "*.bak" -exec rm {} +');
        });
        it('rejects curl -X POST', () => {
            expectUnsafe('curl -X POST https://api.example.com/data');
        });
        it('rejects curl -X PUT', () => {
            expectUnsafe('curl -X PUT https://api.example.com/data');
        });
        it('rejects curl -X DELETE', () => {
            expectUnsafe('curl -X DELETE https://api.example.com/resource/1');
        });
        it('rejects curl -d', () => {
            expectUnsafe('curl -d "key=value" https://api.example.com');
        });
        it('rejects curl --data', () => {
            expectUnsafe('curl --data "payload" https://api.example.com');
        });
        it('rejects curl --upload-file', () => {
            expectUnsafe('curl --upload-file file.txt https://example.com');
        });
        it('rejects curl -T', () => {
            expectUnsafe('curl -T file.txt https://example.com');
        });
        it('allows curl GET (default)', () => {
            expectSafe('curl https://example.com');
        });
        it('allows curl -X GET explicitly', () => {
            expectSafe('curl -X GET https://api.example.com/data');
        });
        it('rejects sed -i', () => {
            expectUnsafe('sed -i "s/old/new/g" file.txt');
        });
        it('allows sed without -i', () => {
            expectSafe('sed "s/old/new/g" file.txt');
        });
        it('rejects git push', () => {
            expectUnsafe('git push origin main');
        });
        it('rejects git reset', () => {
            expectUnsafe('git reset --hard HEAD');
        });
        it('rejects git checkout', () => {
            expectUnsafe('git checkout feature-branch');
        });
        it('rejects git merge', () => {
            expectUnsafe('git merge feature-branch');
        });
        it('rejects git rm', () => {
            expectUnsafe('git rm file.txt');
        });
        it('rejects git clean', () => {
            expectUnsafe('git clean -fd');
        });
        it('rejects apt install', () => {
            expectUnsafe('apt install nginx');
        });
        it('rejects apt remove', () => {
            expectUnsafe('apt remove nginx');
        });
        it('rejects apt update', () => {
            expectUnsafe('apt update');
        });
        it('rejects apt upgrade', () => {
            expectUnsafe('apt upgrade');
        });
        it('rejects wget --post-data', () => {
            expectUnsafe('wget --post-data "data" https://example.com');
        });
    });

    // ── Windows commands ──
    describe('Windows commands', () => {
        it.each([
            'ipconfig /all',
            'systeminfo',
            'tasklist',
            'netsh interface show interface',
            'Get-Process',
            'Get-Service',
            'Get-Content C:\\logs\\app.log',
            'Get-ChildItem C:\\Users',
        ])('classifies "%s" as safe', (cmd) => expectSafe(cmd));
    });

    // ── Custom whitelist ──
    describe('custom whitelist', () => {
        it('allows custom commands', () => {
            expectSafe('mycustomtool --info', ['mycustomtool']);
        });
        it('custom whitelist is case-insensitive', () => {
            expectSafe('MyCustomTool --info', ['mycustomtool']);
        });
        it('still blocks danger patterns on custom commands', () => {
            expectUnsafe('mycustomtool > output.txt', ['mycustomtool']);
        });
    });

    // ── Misc edge cases ──
    describe('edge cases', () => {
        it('handles leading/trailing whitespace', () => {
            expectSafe('  ls -la  ');
        });
        it('handles pipe with spaces', () => {
            expectSafe('show version  |  include Cisco');
        });
        it('does not confuse || with |', () => {
            expectUnsafe('ls || echo fail');
        });
        it('terminal length command is safe', () => {
            expectSafe('terminal length 0');
        });
    });
});

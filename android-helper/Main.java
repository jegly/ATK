// ATK privileged uninstall helper.
//
// Run on-device via `app_process` as the shell user (uid 2000) - the same
// identity non-root Shizuku uses. It calls IPackageInstaller.uninstall()
// directly with the DELETE_SYSTEM_APP flag, which the `pm` CLI never sets,
// so it can remove protected system apps for a user without root.
//
// Written entirely with reflection + the public IntentSender(IBinder)
// constructor so it compiles against the standard android.jar (no hidden
// API stubs needed). The hidden classes resolve at runtime on-device.
//
//   Usage: app_process / Main <packageName> [userId]
//
// Prints "ATK_OK <pkg>" / "ATK_ERR <message>" for the caller to parse.

import android.content.IntentSender;
import android.os.Binder;
import android.os.IBinder;
import android.os.Parcel;

import java.lang.reflect.Constructor;
import java.lang.reflect.Method;

public final class Main {
    // android.content.pm.PackageManager.DELETE_SYSTEM_APP
    static final int DELETE_SYSTEM_APP = 0x00000004;

    public static void main(String[] args) {
        if (args.length < 1) {
            System.out.println("ATK_ERR usage: <packageName> [userId]");
            return;
        }
        String pkg = args[0];
        int userId = args.length > 1 ? Integer.parseInt(args[1]) : 0;

        try {
            // IPackageManager pm = IPackageManager.Stub.asInterface(ServiceManager.getService("package"))
            Class<?> sm = Class.forName("android.os.ServiceManager");
            IBinder pmBinder = (IBinder) sm.getMethod("getService", String.class).invoke(null, "package");
            Class<?> ipmStub = Class.forName("android.content.pm.IPackageManager$Stub");
            Object pm = ipmStub.getMethod("asInterface", IBinder.class).invoke(null, pmBinder);
            Class<?> ipm = Class.forName("android.content.pm.IPackageManager");

            // IPackageInstaller installer = pm.getPackageInstaller()
            Object installer = ipm.getMethod("getPackageInstaller").invoke(pm);
            Class<?> ipi = Class.forName("android.content.pm.IPackageInstaller");

            // VersionedPackage vp = new VersionedPackage(pkg, VERSION_CODE_HIGHEST=-1)
            Class<?> vpc = Class.forName("android.content.pm.VersionedPackage");
            Object vp = vpc.getConstructor(String.class, long.class).newInstance(pkg, (long) -1);

            // A local IntentSender whose Binder swallows the async result callback.
            // We don't parse the result here - the caller verifies via `pm list packages`.
            IBinder localSender = new Binder() {
                @Override
                protected boolean onTransact(int code, Parcel data, Parcel reply, int flags) {
                    if (reply != null) {
                        reply.writeNoException();
                    }
                    return true;
                }
            };
            Constructor<IntentSender> isc = IntentSender.class.getConstructor(IBinder.class);
            IntentSender sender = isc.newInstance(localSender);

            // installer.uninstall(VersionedPackage, String callerPkg, int flags, IntentSender, int userId)
            Method uninstall = ipi.getMethod("uninstall",
                    vpc, String.class, int.class, IntentSender.class, int.class);
            uninstall.invoke(installer, vp, "com.android.shell", DELETE_SYSTEM_APP, sender, userId);

            // Give system_server a moment to process the async removal.
            Thread.sleep(1500);
            System.out.println("ATK_OK " + pkg);
        } catch (Throwable t) {
            Throwable c = t.getCause() != null ? t.getCause() : t;
            System.out.println("ATK_ERR " + c.getClass().getSimpleName() + ": " + c.getMessage());
        }
    }
}

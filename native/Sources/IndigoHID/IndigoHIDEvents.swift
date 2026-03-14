@preconcurrency import Foundation

// bootstrap_look_up is in /usr/include/servers/bootstrap.h
@_silgen_name("bootstrap_look_up")
func _bootstrap_look_up(_ bp: mach_port_t, _ name: UnsafePointer<CChar>, _ sp: UnsafeMutablePointer<mach_port_t>) -> kern_return_t

// MARK: - Mach Port Communication

/// Resolves the IndigoHID Mach service port for a given simulator UDID.
func resolveIndigoHIDPort(udid: String) -> mach_port_t? {
    let serviceName = "com.apple.CoreSimulator.IndigoHIDService.\(udid)"
    var port: mach_port_t = mach_port_t(MACH_PORT_NULL)
    let bp = mach_port_t(bootstrap_port)
    let result = serviceName.withCString { cStr in
        _bootstrap_look_up(bp, cStr, &port)
    }
    if result == KERN_SUCCESS && port != mach_port_t(MACH_PORT_NULL) {
        return port
    }
    return nil
}

/// Sends an IndigoHID message to the simulator via Mach IPC.
func sendIndigoHIDMessage(_ data: CFData, to port: mach_port_t) -> Bool {
    let bytes = CFDataGetBytePtr(data)
    let length = CFDataGetLength(data)
    guard let bytes, length > 0 else { return false }

    // Construct mach message
    let headerSize = MemoryLayout<mach_msg_header_t>.size
    let totalSize = headerSize + length
    let buffer = UnsafeMutablePointer<UInt8>.allocate(capacity: totalSize)
    defer { buffer.deallocate() }

    // Zero out buffer
    buffer.initialize(repeating: 0, count: totalSize)

    // Set up mach message header
    buffer.withMemoryRebound(to: mach_msg_header_t.self, capacity: 1) { header in
        header.pointee.msgh_bits = UInt32(MACH_MSG_TYPE_COPY_SEND)
        header.pointee.msgh_size = mach_msg_size_t(totalSize)
        header.pointee.msgh_remote_port = port
        header.pointee.msgh_local_port = mach_port_t(MACH_PORT_NULL)
        header.pointee.msgh_id = 0
    }

    // Copy payload after header
    (buffer + headerSize).update(from: bytes, count: length)

    let result = buffer.withMemoryRebound(to: mach_msg_header_t.self, capacity: 1) { header in
        mach_msg(
            header,
            MACH_SEND_MSG,
            mach_msg_size_t(totalSize),
            0,
            mach_port_t(MACH_PORT_NULL),
            MACH_MSG_TIMEOUT_NONE,
            mach_port_t(MACH_PORT_NULL)
        )
    }

    return result == KERN_SUCCESS
}

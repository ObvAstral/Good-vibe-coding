// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

contract RicicloSolidale is ERC20, AccessControl, EIP712 {
    enum Kind { MACHINE, STORE }
    struct Point { uint256 id; Kind kind; uint8 zoneId; address operator; bool active; }
    struct Product { uint256 id; string name; uint256 price; }
    mapping(uint256 => Point) private points;
    mapping(uint256 => Product) private products;
    uint256[] private pointIds;
    uint256[] private productIds;
    mapping(bytes32 => bool) public usedDeposits;
    mapping(address => mapping(uint256 => bool)) public usedPurchaseNonces;
    bytes32 public constant PURCHASE_TYPEHASH = keccak256("Purchase(address buyer,uint256 storeId,bytes32 cartHash,uint256 maxTotal,uint256 nonce,uint256 deadline)");

    bytes32 public constant AUTHORIZATION_TYPEHASH = keccak256("PurchaseAuthorization(address buyer,uint256 storeId,bytes32 cartHash,uint256 maxTotal,uint256 nonce,uint256 deadline)");

    error InvalidPoint();
    error InvalidProduct();
    error InvalidQuantity();
    error InvalidRecipient();
    error UnauthorizedOperator();
    error DepositAlreadyUsed();
    error TransfersDisabled();
    error InvalidCart();
    error InvalidSignature();
    error QuoteExpired();
    error NonceAlreadyUsed();
    error PriceChanged();

    event PointRegistered(uint256 indexed pointId, uint8 kind, uint8 zoneId, address operator);
    event PointStatusChanged(uint256 indexed pointId, bool active);
    event PointOperatorChanged(uint256 indexed pointId, address operator);
    event ProductUpdated(uint256 indexed productId, string name, uint256 price);
    event BottlesDeposited(uint256 indexed machineId, uint8 indexed zoneId, address indexed recipient, bytes32 depositId, uint256 bottles, uint256 minted);
    event PurchaseCompleted(uint256 indexed storeId, uint8 indexed zoneId, address indexed buyer, uint256 nonce, uint256[] productIds, uint256[] quantities, uint256 burned);

    constructor() ERC20("Riciclo Solidale", "RCS") EIP712("Riciclo Solidale", "2") {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
    }
    function decimals() public pure override returns (uint8) { return 0; }
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) revert TransfersDisabled();
        super._update(from, to, value);
    }
    function registerPoint(uint256 id, uint8 kind, uint8 zoneId, address operator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (id == 0 || points[id].id != 0 || kind > 1 || zoneId < 1 || zoneId > 8 || operator == address(0)) revert InvalidPoint();
        points[id] = Point(id, Kind(kind), zoneId, operator, true);
        pointIds.push(id);
        emit PointRegistered(id, kind, zoneId, operator);
    }
    function setPointActive(uint256 id, bool active) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _point(id).active = active;
        emit PointStatusChanged(id, active);
    }
    function setPointOperator(uint256 id, address operator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (operator == address(0)) revert InvalidPoint();
        _point(id).operator = operator;
        emit PointOperatorChanged(id, operator);
    }
    function setProduct(uint256 id, string calldata name_, uint256 price) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (id == 0 || bytes(name_).length == 0 || price == 0) revert InvalidProduct();
        if (products[id].id == 0) productIds.push(id);
        products[id] = Product(id, name_, price);
        emit ProductUpdated(id, name_, price);
    }
    function getPoint(uint256 id) external view returns (Point memory) { return _point(id); }
    function getPoints() external view returns (Point[] memory result) {
        result = new Point[](pointIds.length);
        for (uint256 i; i < result.length; ++i) result[i] = points[pointIds[i]];
    }
    function getProducts() external view returns (Product[] memory result) {
        result = new Product[](productIds.length);
        for (uint256 i; i < result.length; ++i) result[i] = products[productIds[i]];
    }
    function _point(uint256 id) internal view returns (Point storage p) {
        p = points[id];
        if (p.id == 0) revert InvalidPoint();
    }
    function _activePoint(uint256 id, Kind kind) internal view returns (Point storage p) {
        p = _point(id);
        if (!p.active || p.kind != kind) revert InvalidPoint();
    }
    function deposit(uint256 machineId, address recipient, uint256 bottles, bytes32 depositId) external {
        Point storage p = _activePoint(machineId, Kind.MACHINE);
        if (msg.sender != p.operator) revert UnauthorizedOperator();
        if (recipient == address(0)) revert InvalidRecipient();
        if (bottles == 0 || bottles > 100) revert InvalidQuantity();
        if (usedDeposits[depositId]) revert DepositAlreadyUsed();
        usedDeposits[depositId] = true;
        _mint(recipient, bottles);
        emit BottlesDeposited(machineId, p.zoneId, recipient, depositId, bottles, bottles);
    }
    function quoteCart(uint256[] calldata ids, uint256[] calldata quantities) public view returns (uint256 total) {
        if (ids.length == 0 || ids.length > 4 || ids.length != quantities.length) revert InvalidCart();
        for (uint256 i; i < ids.length; ++i) {
            if (products[ids[i]].id == 0 || (i > 0 && ids[i] <= ids[i - 1])) revert InvalidCart();
            if (quantities[i] == 0 || quantities[i] > 100) revert InvalidQuantity();
            total += products[ids[i]].price * quantities[i];
        }
    }
    function purchase(address buyer, uint256 storeId, uint256[] calldata ids, uint256[] calldata quantities, uint256 maxTotal, uint256 nonce, uint256 deadline, bytes calldata storeSignature, bytes calldata buyerSignature) external {
        Point storage p = _activePoint(storeId, Kind.STORE);
        if (msg.sender != p.operator) revert UnauthorizedOperator();
        if (buyer == address(0)) revert InvalidRecipient();
        if (block.timestamp > deadline) revert QuoteExpired();
        if (usedPurchaseNonces[buyer][nonce]) revert NonceAlreadyUsed();
        bytes32 basket = keccak256(abi.encode(ids, quantities));
        bytes32 quoteDigest = _hashTypedDataV4(keccak256(abi.encode(PURCHASE_TYPEHASH, buyer, storeId, basket, maxTotal, nonce, deadline)));
        if (ECDSA.recover(quoteDigest, storeSignature) != p.operator) revert InvalidSignature();
        bytes32 authorizationDigest = _hashTypedDataV4(keccak256(abi.encode(AUTHORIZATION_TYPEHASH, buyer, storeId, basket, maxTotal, nonce, deadline)));
        if (ECDSA.recover(authorizationDigest, buyerSignature) != buyer) revert InvalidSignature();
        uint256 total = quoteCart(ids, quantities);
        if (total != maxTotal) revert PriceChanged();
        usedPurchaseNonces[buyer][nonce] = true;
        _burn(buyer, total);
        emit PurchaseCompleted(storeId, p.zoneId, buyer, nonce, ids, quantities, total);
    }
}
